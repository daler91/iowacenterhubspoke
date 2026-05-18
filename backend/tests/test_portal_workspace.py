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

from routers.portal import workspace as portal_workspace  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, field, direction=1):
        reverse = direction == -1
        self.rows.sort(key=lambda row: row.get(field) or "", reverse=reverse)
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, limit):
        await asyncio.sleep(0)
        return list(self.rows[:limit])


class _Collection:
    def __init__(self, rows):
        self.rows = list(rows)

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    def find(self, query, projection=None):
        return _Cursor([_project(row, projection) for row in self.rows if _matches(row, query)])


def _matches(row, query):
    for key, expected in query.items():
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


def _project(row, projection):
    if not projection:
        return dict(row)
    if any(value == 1 for value in projection.values()):
        out = {key: row[key] for key, value in projection.items() if value == 1 and key in row}
    else:
        out = dict(row)
    for key, value in projection.items():
        if value == 0:
            out.pop(key, None)
    return out


def _db():
    return SimpleNamespace(
        projects=_Collection([
            {
                "id": "project-1",
                "partner_org_id": "org-1",
                "title": "Shared Workshop",
                "phase": "planning",
                "event_date": "2026-05-20T10:00:00Z",
                "venue_name": "Main Room",
                "deleted_at": None,
            },
            {
                "id": "project-2",
                "partner_org_id": "org-1",
                "title": "Hosted Class",
                "phase": "complete",
                "event_date": "2026-04-20T10:00:00Z",
                "venue_name": "Main Room",
                "deleted_at": None,
            },
            {
                "id": "project-other",
                "partner_org_id": "org-2",
                "title": "Other Org",
                "phase": "planning",
                "event_date": "2026-05-22T10:00:00Z",
                "venue_name": "Other Room",
                "deleted_at": None,
            },
        ]),
        tasks=_Collection([
            {
                "id": "task-1",
                "project_id": "project-1",
                "owner": "partner",
                "title": "Approve flyer",
                "due_date": "2026-05-01T00:00:00Z",
                "completed": False,
                "sort_order": 1,
                "deleted_at": None,
                "details": "private",
            },
            {
                "id": "task-2",
                "project_id": "project-1",
                "owner": "internal",
                "title": "Internal prep",
                "due_date": "2026-05-01T00:00:00Z",
                "completed": False,
                "sort_order": 2,
                "deleted_at": None,
            },
        ]),
        documents=_Collection([
            {
                "id": "doc-1",
                "project_id": "project-1",
                "partner_org_id": "org-1",
                "filename": "shared.pdf",
                "visibility": "shared",
                "uploaded_at": "2026-05-01T00:00:00Z",
                "deleted_at": None,
            },
            {
                "id": "doc-2",
                "project_id": "project-1",
                "partner_org_id": "org-1",
                "filename": "internal.pdf",
                "visibility": "internal",
                "uploaded_at": "2026-05-01T00:00:00Z",
                "deleted_at": None,
            },
            {
                "id": "doc-org",
                "project_id": None,
                "partner_org_id": "org-1",
                "filename": "partner-guide.pdf",
                "visibility": "shared",
                "uploaded_at": "2026-05-01T00:00:00Z",
                "deleted_at": None,
            },
        ]),
        messages=_Collection([
            {
                "id": "msg-1",
                "project_id": "project-1",
                "visibility": "shared",
                "body": "Shared message",
                "created_at": "2026-05-01T00:00:00Z",
                "deleted_at": None,
            },
            {
                "id": "msg-2",
                "project_id": "project-1",
                "visibility": "internal",
                "body": "Internal message",
                "created_at": "2026-05-01T00:00:00Z",
                "deleted_at": None,
            },
        ]),
    )


def _ctx():
    return {
        "partner_org_id": "org-1",
        "org": {"id": "org-1", "name": "Partner Org"},
        "contact": {"id": "contact-1", "name": "Pat Partner"},
    }


def test_workspace_is_project_first_and_partner_scoped(monkeypatch):
    monkeypatch.setattr(portal_workspace, "db", _db())
    monkeypatch.setattr(portal_workspace, "count_unread", AsyncMock(return_value=3))
    monkeypatch.setattr(portal_workspace, "list_portal_activity", AsyncMock(return_value=[{"id": "activity-1"}]))

    out = asyncio.run(portal_workspace.portal_workspace(_ctx()))

    assert out["summary"]["active_projects"] == 1
    assert out["summary"]["classes_hosted"] == 1
    assert out["summary"]["open_tasks"] == 1
    assert out["projects"][0]["id"] == "project-1"
    assert out["needs_attention"][0]["id"] == "task-1"
    assert "details" not in out["needs_attention"][0]
    assert out["org_documents"][0]["id"] == "doc-org"
    assert out["unread_notifications"] == 3


def test_project_workspace_excludes_internal_resources(monkeypatch):
    monkeypatch.setattr(portal_workspace, "db", _db())
    monkeypatch.setattr(portal_workspace, "list_portal_activity", AsyncMock(return_value=[]))
    monkeypatch.setattr(portal_workspace, "principals_for_project", AsyncMock(return_value=[]))

    out = asyncio.run(portal_workspace.portal_project_workspace("project-1", _ctx()))

    assert out["project"]["id"] == "project-1"
    assert [task["id"] for task in out["tasks"]] == ["task-1"]
    assert [doc["id"] for doc in out["documents"]] == ["doc-1"]
    assert [msg["id"] for msg in out["messages"]] == ["msg-1"]


def test_project_workspace_rejects_cross_org_project(monkeypatch):
    monkeypatch.setattr(portal_workspace, "db", _db())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_workspace.portal_project_workspace("project-other", _ctx()))

    assert exc.value.status_code == 404
