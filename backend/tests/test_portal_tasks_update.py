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
