import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import asyncio

import pytest
from fastapi import HTTPException

sys.path.append(os.path.abspath('backend'))

sys.modules.setdefault('motor', MagicMock())
sys.modules.setdefault('motor.motor_asyncio', MagicMock())
sys.modules.setdefault('dotenv', MagicMock())
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('JWT_SECRET', 'test_secret')

from routers import project_tasks  # noqa: E402
from models.coordination_schemas import TaskUpdate  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return list(self.rows)


def test_update_task_rejects_null_for_non_clearable_field(monkeypatch):
    payload = TaskUpdate(title=None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(project_tasks.update_task('p1', 't1', payload, {'name': 'Editor'}))

    assert exc.value.status_code == 400
    assert exc.value.detail == project_tasks.NULL_NOT_ALLOWED


def test_update_task_allows_due_date_null(monkeypatch):
    payload = TaskUpdate(due_date=None)

    monkeypatch.setattr(
        project_tasks,
        '_cas_apply_task_update',
        AsyncMock(return_value=({'completed': False, 'assigned_to': None}, False)),
    )
    fake_db = SimpleNamespace(
        tasks=SimpleNamespace(find_one=AsyncMock(return_value={'id': 't1', 'project_id': 'p1', 'completed': False})),
        projects=SimpleNamespace(find_one=AsyncMock(return_value={'id': 'p1', 'title': 'P'})),
    )
    monkeypatch.setattr(project_tasks, 'db', fake_db)
    monkeypatch.setattr(project_tasks, 'notify_task_assigned', AsyncMock())
    monkeypatch.setattr(project_tasks, 'notify_task_completed', AsyncMock())
    monkeypatch.setattr(project_tasks, 'maybe_auto_advance_phase_for_task', AsyncMock())

    out = asyncio.run(project_tasks.update_task('p1', 't1', payload, {'name': 'Editor'}))

    assert out['id'] == 't1'


def test_list_task_attachments_scopes_query_by_project(monkeypatch):
    monkeypatch.setattr(project_tasks, '_verify_task', AsyncMock(return_value={'id': 't1'}))
    attachments = SimpleNamespace(
        find=MagicMock(return_value=_Cursor([{'id': 'att-1', 'project_id': 'p1'}])),
    )
    monkeypatch.setattr(project_tasks, 'db', SimpleNamespace(task_attachments=attachments))

    out = asyncio.run(project_tasks.list_task_attachments('p1', 't1', {'user_id': 'u1'}))

    assert out['total'] == 1
    attachments.find.assert_called_once_with(
        {'task_id': 't1', 'project_id': 'p1'},
        {'_id': 0},
    )


def test_delete_task_attachment_verifies_task_before_attachment_lookup(monkeypatch):
    monkeypatch.setattr(
        project_tasks,
        '_verify_task',
        AsyncMock(side_effect=HTTPException(status_code=404, detail='Task not found')),
    )
    attachments = SimpleNamespace(find_one=AsyncMock(), delete_one=AsyncMock())
    monkeypatch.setattr(project_tasks, 'db', SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(project_tasks.delete_task_attachment('p1', 't1', 'att-1', {'name': 'Scheduler'}))

    assert exc.value.status_code == 404
    attachments.find_one.assert_not_awaited()
    attachments.delete_one.assert_not_awaited()


def test_delete_task_attachment_scopes_lookup_and_delete_by_project(monkeypatch):
    monkeypatch.setattr(project_tasks, '_verify_task', AsyncMock(return_value={'id': 't1'}))
    attachments = SimpleNamespace(
        find_one=AsyncMock(return_value={'id': 'att-1', 'file_path': '../stored.pdf'}),
        delete_one=AsyncMock(),
    )
    monkeypatch.setattr(project_tasks, 'db', SimpleNamespace(task_attachments=attachments))
    monkeypatch.setattr(project_tasks.os.path, 'exists', lambda _path: False)

    out = asyncio.run(project_tasks.delete_task_attachment('p1', 't1', 'att-1', {'name': 'Scheduler'}))

    assert out == {'message': 'Attachment deleted'}
    attachments.find_one.assert_awaited_once_with(
        {'id': 'att-1', 'task_id': 't1', 'project_id': 'p1'},
    )
    attachments.delete_one.assert_awaited_once_with(
        {'id': 'att-1', 'task_id': 't1', 'project_id': 'p1'},
    )


def test_download_task_attachment_verifies_task_before_attachment_lookup(monkeypatch):
    monkeypatch.setattr(
        project_tasks,
        '_verify_task',
        AsyncMock(side_effect=HTTPException(status_code=404, detail='Task not found')),
    )
    attachments = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(project_tasks, 'db', SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(project_tasks.download_task_attachment('p1', 't1', 'att-1', {'user_id': 'u1'}))

    assert exc.value.status_code == 404
    attachments.find_one.assert_not_awaited()


def test_download_task_attachment_scopes_lookup_by_project(monkeypatch):
    monkeypatch.setattr(project_tasks, '_verify_task', AsyncMock(return_value={'id': 't1'}))
    attachments = SimpleNamespace(
        find_one=AsyncMock(
            return_value={
                'id': 'att-1',
                'task_id': 't1',
                'project_id': 'p1',
                'file_path': '../stored.pdf',
                'filename': 'Packet.pdf',
            },
        ),
    )
    monkeypatch.setattr(project_tasks, 'db', SimpleNamespace(task_attachments=attachments))
    monkeypatch.setattr(project_tasks.os.path, 'exists', lambda _path: True)

    response = asyncio.run(project_tasks.download_task_attachment('p1', 't1', 'att-1', {'user_id': 'u1'}))

    attachments.find_one.assert_awaited_once_with(
        {'id': 'att-1', 'task_id': 't1', 'project_id': 'p1'},
        {'_id': 0},
    )
    assert response.path.endswith(os.path.join('uploads', 'stored.pdf'))
