"""Regression tests for auto phase-advance and soft-deleted tasks.

``maybe_auto_advance_phase_for_task`` advances a project when every task in
its current phase is complete. It counted tasks without a ``deleted_at: None``
filter, so a soft-deleted *incomplete* task was still counted as "remaining"
and permanently blocked the advance even after every visible task was done.
"""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.append(os.path.abspath("backend"))
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-32-bytes-long!!!")

from services import phase_advance  # noqa: E402


def _matches(row, query):
    for key, value in query.items():
        if isinstance(value, dict):
            if "$ne" in value:
                if row.get(key) == value["$ne"]:
                    return False
            else:  # pragma: no cover - not used here
                return False
        elif row.get(key) != value:
            return False
    return True


class _Tasks:
    def __init__(self, rows):
        self.rows = rows

    async def count_documents(self, query):
        await asyncio.sleep(0)
        return sum(1 for r in self.rows if _matches(r, query))


class _Projects:
    def __init__(self, project):
        self.project = project
        self.update_calls = []

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        if self.project.get("id") == query.get("id") and self.project.get("deleted_at") is None:
            return dict(self.project)
        return None

    async def update_one(self, query, update):
        await asyncio.sleep(0)
        self.update_calls.append((query, update))

        class _Res:
            modified_count = 1
        return _Res()


def _run(project, tasks, monkeypatch):
    fake_db = MagicMock()
    fake_db.tasks = _Tasks(tasks)
    projects = _Projects(project)
    fake_db.projects = projects
    monkeypatch.setattr(phase_advance, "db", fake_db)
    monkeypatch.setattr(phase_advance, "log_activity", AsyncMock())
    monkeypatch.setattr(phase_advance, "notify_project_phase_advanced", AsyncMock())
    result = asyncio.run(
        phase_advance.maybe_auto_advance_phase_for_task(
            project_id="p1",
            completed_task_phase="planning",
            actor={"name": "Tester", "user_id": "u1"},
        )
    )
    return result, projects


def test_soft_deleted_incomplete_task_does_not_block_advance(monkeypatch):
    project = {"id": "p1", "phase": "planning", "title": "T", "partner_org_id": "o1",
               "deleted_at": None}
    tasks = [
        {"project_id": "p1", "phase": "planning", "completed": True, "deleted_at": None},
        # incomplete but soft-deleted — must not count as remaining
        {"project_id": "p1", "phase": "planning", "completed": False,
         "deleted_at": "2026-01-01T00:00:00+00:00"},
    ]
    result, projects = _run(project, tasks, monkeypatch)
    assert result == "promotion"
    assert projects.update_calls, "expected the project phase to be advanced"


def test_live_incomplete_task_still_blocks_advance(monkeypatch):
    project = {"id": "p1", "phase": "planning", "title": "T", "partner_org_id": "o1",
               "deleted_at": None}
    tasks = [
        {"project_id": "p1", "phase": "planning", "completed": True, "deleted_at": None},
        {"project_id": "p1", "phase": "planning", "completed": False, "deleted_at": None},
    ]
    result, projects = _run(project, tasks, monkeypatch)
    assert result is None
    assert not projects.update_calls


def test_phase_with_only_deleted_tasks_does_not_advance(monkeypatch):
    project = {"id": "p1", "phase": "planning", "title": "T", "partner_org_id": "o1",
               "deleted_at": None}
    tasks = [
        {"project_id": "p1", "phase": "planning", "completed": True,
         "deleted_at": "2026-01-01T00:00:00+00:00"},
    ]
    result, projects = _run(project, tasks, monkeypatch)
    assert result is None
    assert not projects.update_calls
