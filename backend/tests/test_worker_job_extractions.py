from jobs.schedule_jobs import time_to_minutes, _check_day_conflicts, _check_town_to_town
from jobs.calendar_jobs import _add_minutes, _subtract_minutes
from worker import WorkerSettings


def test_time_calculations_helpers():
    assert time_to_minutes("01:30") == 90
    assert _add_minutes("23:50", 20) == "00:10"
    assert _subtract_minutes("00:10", 20) == "00:00"


def test_conflict_logic_detects_overlap_with_drive_time():
    day = [{"id": "s1", "start_time": "10:00", "end_time": "11:00", "drive_time_minutes": 30, "location_name": "A", "location_id": "l1"}]
    conflicts = _check_day_conflicts(day, 10 * 60 + 20, 11 * 60 + 10)
    assert len(conflicts) == 1
    assert conflicts[0]["schedule_id"] == "s1"


def test_town_to_town_warning_text():
    day = [{"location_id": "l2"}]
    loc_map = {"l2": {"city_name": "Grinnell"}}
    hit, warning = _check_town_to_town(day, "l1", loc_map)
    assert hit is True
    assert "Grinnell" in warning


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
