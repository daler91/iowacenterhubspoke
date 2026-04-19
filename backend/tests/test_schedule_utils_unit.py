import os
import sys
import asyncio
from unittest.mock import MagicMock

# Stub heavy deps the production modules import, but only when the real
# package is NOT already installed. Unconditionally clobbering these via
# ``sys.modules[...] = MagicMock()`` poisons other tests in the same
# session that need the real FastAPI/Motor — so prefer ``setdefault``.
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

# We need a real-ish Pydantic for the schemas to load
try:
    from pydantic import BaseModel  # noqa: F401
except ImportError:
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
    mock_pydantic = MagicMock()
    mock_pydantic.BaseModel = BaseModel
    sys.modules.setdefault("pydantic", mock_pydantic)

try:  # pragma: no cover - only used when fastapi is missing in CI
    import fastapi  # noqa: F401
except ImportError:
    sys.modules["fastapi"] = MagicMock()

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest
from datetime import date
from services.schedule_utils import (
    time_to_minutes,
    calculate_class_minutes,
    add_months,
    get_start_weekday_value
)

schedule_utils = sys.modules["services.schedule_utils"]


class AsyncCursor:
    def __init__(self, docs):
        self._iter = iter(docs)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class FakeSchedulesCollection:
    def __init__(self, docs):
        self.docs = docs
        self.last_query = None
        self.last_projection = None

    def find(self, query, projection):
        self.last_query = query
        self.last_projection = projection
        return AsyncCursor(self.docs)

def test_time_to_minutes():
    assert time_to_minutes("00:00") == 0
    assert time_to_minutes("01:30") == 90
    assert time_to_minutes("12:00") == 720
    assert time_to_minutes("23:59") == 1439
    assert time_to_minutes("9:00") == 540

def test_calculate_class_minutes():
    assert calculate_class_minutes("10:00", "11:30") == 90
    assert calculate_class_minutes("10:00", "10:00") == 0
    assert calculate_class_minutes("11:00", "10:00") == -60

def test_add_months():
    # Negative months (subtraction)
    assert add_months(date(2024, 2, 1), -1) == date(2024, 1, 1)

    # Negative months crossing year boundary
    assert add_months(date(2024, 1, 1), -1) == date(2023, 12, 1)

    # Negative multiple years
    assert add_months(date(2024, 1, 1), -24) == date(2022, 1, 1)

    # Negative months from long month to short month
    assert add_months(date(2024, 3, 31), -1) == date(2024, 2, 29)
    assert add_months(date(2023, 3, 31), -1) == date(2023, 2, 28)

    # Negative months from long month to short month crossing year boundary
    assert add_months(date(2024, 3, 31), -13) == date(2023, 2, 28)

    # Zero months
    assert add_months(date(2024, 2, 15), 0) == date(2024, 2, 15)

    # Regular case
    assert add_months(date(2024, 1, 1), 1) == date(2024, 2, 1)
    # Month end adjustment (2023 is not a leap year)
    assert add_months(date(2023, 1, 31), 1) == date(2023, 2, 28)
    # Leap year case
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    # Year wrap
    assert add_months(date(2024, 12, 1), 2) == date(2025, 2, 1)
    # Multiple years wrap
    assert add_months(date(2024, 1, 1), 24) == date(2026, 1, 1)

def test_get_start_weekday_value():
    assert get_start_weekday_value(date(2025, 2, 23)) == 0
    assert get_start_weekday_value(date(2025, 2, 24)) == 1
    assert get_start_weekday_value(date(2025, 3, 1)) == 6


def test_check_conflicts_handles_more_than_100_candidates(monkeypatch):
    docs = [
        {
            "id": f"non-overlap-{idx}",
            "date": "2026-03-01",
            "start_time": "06:00",
            "end_time": "07:00",
            "drive_time_minutes": 0,
            "location_name": "Far Away",
        }
        for idx in range(100)
    ]
    docs.append(
        {
            "id": "overlap-after-100",
            "date": "2026-03-01",
            "start_time": "10:15",
            "end_time": "10:45",
            "drive_time_minutes": 0,
            "location_name": "Overlap Site",
        }
    )

    fake_schedules = FakeSchedulesCollection(docs)
    monkeypatch.setattr(schedule_utils.db, "schedules", fake_schedules)

    conflicts = asyncio.run(
        schedule_utils.check_conflicts(
            employee_id="emp-1",
            date="2026-03-01",
            start_time="10:00",
            end_time="11:00",
            drive_minutes=0,
        )
    )

    assert len(conflicts) == 1
    assert conflicts[0]["schedule_id"] == "overlap-after-100"
    assert fake_schedules.last_projection == schedule_utils.SCHEDULE_CONFLICT_PROJECTION


def test_check_conflicts_bulk_handles_more_than_10000_candidates(monkeypatch):
    dates = ["2026-03-02", "2026-03-03"]
    docs = [
        {
            "id": f"non-overlap-{idx}",
            "date": dates[idx % 2],
            "start_time": "05:00",
            "end_time": "06:00",
            "drive_time_minutes": 0,
            "location_name": "Far Away",
        }
        for idx in range(10_000)
    ]
    docs.extend(
        [
            {
                "id": "overlap-a",
                "date": dates[0],
                "start_time": "10:15",
                "end_time": "10:45",
                "drive_time_minutes": 0,
                "location_name": "Overlap Site A",
            },
            {
                "id": "overlap-b",
                "date": dates[1],
                "start_time": "10:30",
                "end_time": "11:00",
                "drive_time_minutes": 0,
                "location_name": "Overlap Site B",
            },
        ]
    )

    fake_schedules = FakeSchedulesCollection(docs)
    monkeypatch.setattr(schedule_utils.db, "schedules", fake_schedules)

    conflicts_by_date = asyncio.run(
        schedule_utils.check_conflicts_bulk(
            employee_id="emp-1",
            dates=dates,
            start_time="10:00",
            end_time="11:00",
            drive_minutes=0,
        )
    )

    assert len(conflicts_by_date[dates[0]]) == 1
    assert conflicts_by_date[dates[0]][0]["schedule_id"] == "overlap-a"
    assert len(conflicts_by_date[dates[1]]) == 1
    assert conflicts_by_date[dates[1]][0]["schedule_id"] == "overlap-b"
    assert fake_schedules.last_projection == schedule_utils.SCHEDULE_CONFLICT_PROJECTION
