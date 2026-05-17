import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncio

import pytest
from fastapi import HTTPException

sys.path.append(os.path.abspath("backend"))

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from routers.portal import tasks as portal_tasks  # noqa: E402
from core.pagination import PaginationParams  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    def skip(self, count):
        self.rows = self.rows[count:]
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return list(self.rows)


def test_portal_update_task_accepts_partner_owner(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "partner", "completed": False}),
    )
    monkeypatch.setattr(portal_tasks, "maybe_auto_advance_phase_for_task", AsyncMock())
    fake_db = SimpleNamespace(tasks=SimpleNamespace(update_one=AsyncMock()))
    monkeypatch.setattr(portal_tasks, "db", fake_db)

    payload = portal_tasks.PortalTaskUpdate(status="completed", completed=True)
    out = asyncio.run(portal_tasks.portal_update_task("p1", "t1", payload, {"contact": {"id": "c1", "name": "Partner User"}}))

    assert out["status"] == "completed"
    assert out["completed"] is True


def test_portal_update_task_accepts_both_owner(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t2", "project_id": "p1", "owner": "both", "completed": False}),
    )
    monkeypatch.setattr(portal_tasks, "maybe_auto_advance_phase_for_task", AsyncMock())
    fake_db = SimpleNamespace(tasks=SimpleNamespace(update_one=AsyncMock()))
    monkeypatch.setattr(portal_tasks, "db", fake_db)

    out = asyncio.run(portal_tasks.portal_update_task("p1", "t2", portal_tasks.PortalTaskUpdate(completed=True), {"contact": {"id": "c1"}}))
    assert out["completed"] is True


def test_require_partner_task_allows_legacy_owner_case(monkeypatch):
    fake_db = SimpleNamespace(tasks=SimpleNamespace(find_one=AsyncMock(return_value={"id": "t3", "owner": "Partner", "project_id": "p1"})))
    monkeypatch.setattr(portal_tasks, "db", fake_db)
    task = asyncio.run(portal_tasks._require_partner_task("t3", "p1"))
    assert task["owner"] == "Partner"


def test_require_partner_task_rejects_internal_owner(monkeypatch):
    fake_db = SimpleNamespace(
        tasks=SimpleNamespace(
            find_one=AsyncMock(return_value={"id": "t-internal", "owner": "internal", "project_id": "p1"})
        )
    )
    monkeypatch.setattr(portal_tasks, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_tasks._require_partner_task("t-internal", "p1"))

    assert exc.value.status_code == 404


def test_require_partner_task_scopes_lookup_to_requested_project(monkeypatch):
    tasks = SimpleNamespace(find_one=AsyncMock(return_value=None))
    fake_db = SimpleNamespace(tasks=tasks)
    monkeypatch.setattr(portal_tasks, "db", fake_db)

    with pytest.raises(HTTPException):
        asyncio.run(portal_tasks._require_partner_task("t1", "project-a"))

    tasks.find_one.assert_awaited_once_with(
        {"id": "t1", "project_id": "project-a", "deleted_at": None},
    )


def test_portal_task_attachments_requires_partner_project_before_query(monkeypatch):
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_project",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="Project not found")),
    )
    require_task = AsyncMock()
    monkeypatch.setattr(portal_tasks, "_require_partner_task", require_task)
    attachments = SimpleNamespace(find=MagicMock())
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_tasks.portal_task_attachments("p1", "t1", {"partner_org_id": "org-other"}))

    assert exc.value.status_code == 404
    require_task.assert_not_awaited()
    attachments.find.assert_not_called()


def test_portal_task_attachments_requires_partner_visible_task(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="Task not found")),
    )
    attachments = SimpleNamespace(find=MagicMock())
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_tasks.portal_task_attachments("p1", "t-internal", {"partner_org_id": "org1"}))

    assert exc.value.status_code == 404
    attachments.find.assert_not_called()


def test_portal_task_attachments_filter_by_project_and_task(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "partner"}),
    )
    attachments = SimpleNamespace(
        find=MagicMock(return_value=_Cursor([{"id": "att-1", "task_id": "t1", "project_id": "p1"}]))
    )
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    out = asyncio.run(portal_tasks.portal_task_attachments("p1", "t1", {"partner_org_id": "org1"}))

    assert out["total"] == 1
    attachments.find.assert_called_once_with({"task_id": "t1", "project_id": "p1"}, {"_id": 0})


def test_portal_task_comments_filter_count_and_rows_by_project_and_task(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "both"}),
    )
    comments = SimpleNamespace(
        count_documents=AsyncMock(return_value=1),
        find=MagicMock(return_value=_Cursor([{"id": "comment-1", "task_id": "t1", "project_id": "p1"}])),
    )
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_comments=comments))

    out = asyncio.run(
        portal_tasks.portal_task_comments(
            "p1",
            "t1",
            {"partner_org_id": "org1"},
            PaginationParams(skip=0, limit=50),
        )
    )

    scope = {"task_id": "t1", "project_id": "p1"}
    assert out["total"] == 1
    comments.count_documents.assert_awaited_once_with(scope)
    comments.find.assert_called_once_with(scope, {"_id": 0})


def test_portal_task_detail_filters_child_resources_by_project_and_task(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"_id": "mongo", "id": "t1", "project_id": "p1", "owner": "partner", "details": "private"}),
    )
    attachments = SimpleNamespace(find=MagicMock(return_value=_Cursor([{"id": "att-1"}])))
    comments = SimpleNamespace(find=MagicMock(return_value=_Cursor([{"id": "comment-1"}])))
    monkeypatch.setattr(
        portal_tasks,
        "db",
        SimpleNamespace(task_attachments=attachments, task_comments=comments),
    )

    out = asyncio.run(portal_tasks.portal_task_detail("p1", "t1", {"partner_org_id": "org1"}))

    scope = {"task_id": "t1", "project_id": "p1"}
    assert "_id" not in out
    assert "details" not in out
    assert out["attachment_count"] == 1
    assert out["comment_count"] == 1
    attachments.find.assert_called_once_with(scope, {"_id": 0})
    comments.find.assert_called_once_with(scope, {"_id": 0})


def test_portal_download_task_attachment_requires_partner_project_before_query(monkeypatch):
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_project",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="Project not found")),
    )
    require_task = AsyncMock()
    monkeypatch.setattr(portal_tasks, "_require_partner_task", require_task)
    attachments = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            portal_tasks.portal_download_task_attachment(
                "p1",
                "t1",
                "att-1",
                {"partner_org_id": "org-other"},
            )
        )

    assert exc.value.status_code == 404
    require_task.assert_not_awaited()
    attachments.find_one.assert_not_awaited()


def test_portal_download_task_attachment_requires_partner_visible_task(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="Task not found")),
    )
    attachments = SimpleNamespace(find_one=AsyncMock())
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            portal_tasks.portal_download_task_attachment(
                "p1",
                "t-internal",
                "att-1",
                {"partner_org_id": "org1"},
            )
        )

    assert exc.value.status_code == 404
    attachments.find_one.assert_not_awaited()


def test_portal_download_task_attachment_scopes_lookup_to_project(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "partner"}),
    )
    attachments = SimpleNamespace(find_one=AsyncMock(return_value=None))
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            portal_tasks.portal_download_task_attachment(
                "p1",
                "t1",
                "att-other-project",
                {"partner_org_id": "org1"},
            )
        )

    assert exc.value.status_code == 404
    attachments.find_one.assert_awaited_once_with(
        {"id": "att-other-project", "task_id": "t1", "project_id": "p1"},
        {"_id": 0},
    )


def test_portal_download_task_attachment_returns_attachment_response(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "both"}),
    )
    attachments = SimpleNamespace(
        find_one=AsyncMock(
            return_value={
                "id": "att-1",
                "task_id": "t1",
                "project_id": "p1",
                "file_path": "../stored.pdf",
                "filename": "Partner Packet.pdf",
            },
        ),
    )
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))
    monkeypatch.setattr(portal_tasks.os.path, "exists", lambda _path: True)

    response = asyncio.run(
        portal_tasks.portal_download_task_attachment(
            "p1",
            "t1",
            "att-1",
            {"partner_org_id": "org1"},
        )
    )

    assert response.path.endswith(os.path.join("uploads", "stored.pdf"))
    assert response.headers["content-disposition"].startswith("attachment;")


def test_portal_preview_task_attachment_returns_inline_response(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t1", "project_id": "p1", "owner": "partner"}),
    )
    attachments = SimpleNamespace(
        find_one=AsyncMock(
            return_value={
                "id": "att-1",
                "task_id": "t1",
                "project_id": "p1",
                "file_path": "stored.pdf",
                "filename": "Partner Packet.pdf",
            },
        ),
    )
    monkeypatch.setattr(portal_tasks, "db", SimpleNamespace(task_attachments=attachments))
    monkeypatch.setattr(portal_tasks.os.path, "exists", lambda _path: True)

    response = asyncio.run(
        portal_tasks.portal_download_task_attachment(
            "p1",
            "t1",
            "att-1",
            {"partner_org_id": "org1"},
            inline=True,
        )
    )

    assert response.headers["content-disposition"].startswith("inline;")


def test_portal_update_task_invalid_status(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(portal_tasks, "_require_partner_task", AsyncMock(return_value={"id": "t4", "owner": "partner"}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_tasks.portal_update_task("p1", "t4", portal_tasks.PortalTaskUpdate(status="bad"), {"contact": {"id": "c1"}}))
    assert exc.value.status_code == 400


def test_portal_update_task_malformed_due_date(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(portal_tasks, "_require_partner_task", AsyncMock(return_value={"id": "t5", "owner": "partner"}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_tasks.portal_update_task("p1", "t5", portal_tasks.PortalTaskUpdate(due_date="not-a-date"), {"contact": {"id": "c1"}}))
    assert exc.value.status_code == 400



def test_portal_update_task_due_date_overflow_returns_400(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(portal_tasks, "_require_partner_task", AsyncMock(return_value={"id": "t7", "owner": "partner"}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            portal_tasks.portal_update_task(
                "p1",
                "t7",
                portal_tasks.PortalTaskUpdate(due_date="0001-01-01T00:00:00+23:59"),
                {"contact": {"id": "c1"}},
            ),
        )
    assert exc.value.status_code == 400


def test_portal_update_task_tolerates_auto_advance_failure(monkeypatch):
    monkeypatch.setattr(portal_tasks, "_require_partner_project", AsyncMock(return_value={"id": "p1"}))
    monkeypatch.setattr(
        portal_tasks,
        "_require_partner_task",
        AsyncMock(return_value={"id": "t6", "project_id": "p1", "owner": "partner", "phase": "planning", "completed": False}),
    )
    monkeypatch.setattr(portal_tasks, "maybe_auto_advance_phase_for_task", AsyncMock(side_effect=RuntimeError("boom")))
    fake_db = SimpleNamespace(tasks=SimpleNamespace(update_one=AsyncMock()))
    monkeypatch.setattr(portal_tasks, "db", fake_db)

    out = asyncio.run(
        portal_tasks.portal_update_task(
            "p1",
            "t6",
            portal_tasks.PortalTaskUpdate(completed=True, status="completed"),
            {"contact": {"id": "c1", "name": "Partner"}},
        ),
    )
    assert out["completed"] is True
