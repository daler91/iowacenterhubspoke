import os
import sys
import asyncio
from unittest.mock import AsyncMock, MagicMock
import pytest

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers import system as system_router


class _Cursor:
    def __init__(self, docs):
        self._docs = docs
        self._skip = 0
        self._limit = None

    def skip(self, n):
        self._skip = n
        return self

    def limit(self, n):
        self._limit = n
        return self

    async def to_list(self, _length):
        rows = self._docs[self._skip:]
        if self._limit is not None:
            rows = rows[: self._limit]
        return list(rows)


class _Collection:
    def __init__(self, docs):
        self._docs = list(docs)

    def find(self, query, projection=None):
        def matches(doc):
            for key, value in query.items():
                if doc.get(key) != value:
                    return False
            return True

        matched = [d for d in self._docs if matches(d)]
        return _Cursor(matched)


class _DB:
    def __init__(self, schedules, employees):
        self.schedules = _Collection(schedules)
        self.employees = _Collection(employees)


@pytest.fixture
def huge_notification_db():
    today = "2026-04-22"
    schedules = [
        {
            "id": f"sch-{idx}",
            "date": today,
            "deleted_at": None,
            "status": "upcoming",
            "class_name": f"Class {idx}",
            "start_time": "09:00",
            "end_time": "10:00",
            "employees": [],
            "employee_ids": [],
            "created_at": today,
            "town_to_town": False,
        }
        for idx in range(120)
    ]
    employees = [
        {"id": f"emp-{idx}", "name": f"Employee {idx}", "deleted_at": None}
        for idx in range(130)
    ]
    return _DB(schedules=schedules, employees=employees)


def test_notifications_paginate_with_metadata_and_no_100_cap(monkeypatch, huge_notification_db):
    monkeypatch.setattr(system_router, "db", huge_notification_db)

    import services.notification_prefs as prefs_mod

    monkeypatch.setattr(prefs_mod, "load_principal", AsyncMock(return_value=None))

    result = asyncio.run(system_router.get_notifications(user={"user_id": "u1"}))

    # 120 upcoming + 130 idle = 250 total; default page returns 200.
    assert result["total"] == 250
    assert result["returned"] == 200
    assert result["has_more"] is True
    assert len(result["items"]) == 200


def test_notifications_second_page_reports_has_more_false(monkeypatch, huge_notification_db):
    monkeypatch.setattr(system_router, "db", huge_notification_db)

    import services.notification_prefs as prefs_mod

    monkeypatch.setattr(prefs_mod, "load_principal", AsyncMock(return_value=None))

    result = asyncio.run(
        system_router.get_notifications(user={"user_id": "u1"}, skip=200, limit=200)
    )

    assert result["total"] == 250
    assert result["returned"] == 50
    assert result["has_more"] is False
    assert len(result["items"]) == 50
