import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from routers import schedule_create
from services import schedule_utils


def test_check_external_conflicts_passes_preloaded_employee(monkeypatch):
    employee = {
        "id": "emp-1",
        "name": "Alex",
        "email": "alex@example.com",
        "google_calendar_connected": True,
        "google_calendar_email": "alex.g@example.com",
    }
    data = SimpleNamespace(
        force_outlook=False,
        force_google=False,
        start_time="09:00",
        end_time="10:00",
    )

    outlook_mock = AsyncMock(return_value=[{"source": "outlook"}])
    google_mock = AsyncMock(return_value=[{"source": "google"}])
    monkeypatch.setattr(schedule_create, "check_outlook_conflicts", outlook_mock)
    monkeypatch.setattr(schedule_create, "check_google_conflicts", google_mock)

    result = asyncio.run(
        schedule_create._check_external_conflicts([employee], data, "2026-04-20")
    )

    assert result == {
        "emp-1": {
            "name": "Alex",
            "outlook": [{"source": "outlook"}],
            "google": [{"source": "google"}],
        }
    }
    assert outlook_mock.await_args.kwargs["employee"] == employee
    assert google_mock.await_args.kwargs["employee"] == employee


def test_outlook_conflicts_skips_employee_lookup_when_preloaded(monkeypatch):
    employee = {"id": "emp-1", "email": "alex@example.com"}
    find_one = AsyncMock(side_effect=AssertionError("employee lookup should be skipped"))
    monkeypatch.setattr(schedule_utils.db.employees, "find_one", find_one)
    monkeypatch.setattr("core.outlook_config.OUTLOOK_CALENDAR_ENABLED", True)

    availability = AsyncMock(return_value=[{"busy": True}])
    monkeypatch.setattr("services.outlook.check_outlook_availability", availability)

    result = asyncio.run(
        schedule_utils.check_outlook_conflicts(
            "emp-1", "2026-04-20", "09:00", "10:00", employee=employee,
        )
    )

    assert result == [{"busy": True}]
    find_one.assert_not_called()
    availability.assert_awaited_once()


def test_google_conflicts_skips_employee_lookup_when_preloaded(monkeypatch):
    employee = {
        "id": "emp-1",
        "email": "alex@example.com",
        "google_calendar_connected": True,
        "google_calendar_email": "alex.g@example.com",
    }
    find_one = AsyncMock(side_effect=AssertionError("employee lookup should be skipped"))
    monkeypatch.setattr(schedule_utils.db.employees, "find_one", find_one)
    monkeypatch.setattr("core.google_config.GOOGLE_CALENDAR_ENABLED", True)

    availability = AsyncMock(return_value=[{"busy": True}])
    monkeypatch.setattr("services.google_calendar.check_google_availability", availability)

    result = asyncio.run(
        schedule_utils.check_google_conflicts(
            "emp-1", "2026-04-20", "09:00", "10:00", employee=employee,
        )
    )

    assert result == [{"busy": True}]
    find_one.assert_not_called()
    availability.assert_awaited_once()
