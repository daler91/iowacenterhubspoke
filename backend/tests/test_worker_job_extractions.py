"""Unit tests for the bulk-schedule helpers the arq worker actually runs.

These previously imported from ``jobs/schedule_jobs.py`` and
``jobs/calendar_jobs.py`` — a flat, pre-package layout that ``worker.py`` had
stopped importing. Those modules were verbatim copies, so the suite was
green while exercising code that never executed in production, and the live
implementations in ``worker.py`` had no direct coverage at all. The duplicates
are gone; these now target the real thing.

Time arithmetic for calendar events lives in ``services/calendar_sync.py``
(``add_minutes_to_time`` / ``subtract_minutes_from_time``) and is covered by
``test_calendar_sync_unit.py`` — not duplicated here.
"""

import worker
from services.schedule_utils import time_to_minutes
from worker import WorkerSettings, _check_day_conflicts, _check_town_to_town


def test_worker_reuses_the_shared_time_helper():
    """worker.py used to carry its own byte-identical copy of this."""
    assert worker.time_to_minutes is time_to_minutes
    assert time_to_minutes("01:30") == 90
    assert time_to_minutes("00:00") == 0


def test_conflict_logic_detects_overlap_with_drive_time():
    day = [{
        "id": "s1", "start_time": "10:00", "end_time": "11:00",
        "drive_time_minutes": 30, "location_name": "A", "location_id": "l1",
    }]
    conflicts = _check_day_conflicts(day, 10 * 60 + 20, 11 * 60 + 10)
    assert len(conflicts) == 1
    assert conflicts[0]["schedule_id"] == "s1"


def test_conflict_logic_ignores_non_overlapping_days():
    day = [{
        "id": "s1", "start_time": "08:00", "end_time": "09:00",
        "drive_time_minutes": 0, "location_name": "A", "location_id": "l1",
    }]
    assert _check_day_conflicts(day, 14 * 60, 15 * 60) == []


def test_town_to_town_warning_text():
    day = [{"location_id": "l2"}]
    loc_map = {"l2": {"city_name": "Grinnell"}}
    hit, warning = _check_town_to_town(day, "l1", loc_map)
    assert hit is True
    assert "Grinnell" in warning


def test_town_to_town_quiet_when_same_location():
    day = [{"location_id": "l1"}]
    loc_map = {"l1": {"city_name": "Des Moines"}}
    hit, _ = _check_town_to_town(day, "l1", loc_map)
    assert hit is False


def test_worker_function_names_smoke_stable():
    names = {fn.__name__ for fn in WorkerSettings.functions}
    assert {
        "generate_bulk_schedules",
        "sync_schedules_denormalized",
        "create_outlook_event",
        "delete_outlook_event",
        "create_google_event",
        "delete_google_event",
        "deliver_webhook_job",
        "send_password_reset_email_job",
        "send_partner_magic_link_email_job",
    }.issubset(names)
