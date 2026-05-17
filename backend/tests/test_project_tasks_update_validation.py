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
