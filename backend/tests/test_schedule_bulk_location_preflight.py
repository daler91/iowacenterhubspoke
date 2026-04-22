import asyncio

from routers import schedule_bulk


def test_preflight_location_conflicts_checks_all_assignees(monkeypatch):
    schedules = [{
        "id": "sched-1",
        "date": "2026-04-22",
        "start_time": "09:00",
        "end_time": "10:00",
        "employee_ids": ["emp-1", "emp-2"],
    }]
    seen = []

    async def _fake_check_conflicts(
        employee_id, date, start_time, end_time, new_drive_time, exclude_id,
    ):
        seen.append(
            (employee_id, date, start_time, end_time, new_drive_time, exclude_id)
        )
        if employee_id == "emp-2":
            return [{"id": "existing-2"}]
        return []

    monkeypatch.setattr(schedule_bulk, "check_conflicts", _fake_check_conflicts)

    preview = asyncio.run(
        schedule_bulk._preflight_location_conflicts(schedules, new_drive_time=25)
    )

    assert [call[0] for call in seen] == ["emp-1", "emp-2"]
    assert preview == [{
        "schedule_id": "sched-1",
        "date": "2026-04-22",
        "employee_id": "emp-2",
        "conflicts": [{"id": "existing-2"}],
    }]


def test_preflight_location_conflicts_keeps_single_assignee_shape(monkeypatch):
    schedules = [{
        "id": "sched-2",
        "date": "2026-04-22",
        "start_time": "11:00",
        "end_time": "12:00",
        "employee_ids": ["emp-1"],
    }]

    async def _fake_check_conflicts(*_args, **_kwargs):
        return [{"id": "existing-1"}]

    monkeypatch.setattr(schedule_bulk, "check_conflicts", _fake_check_conflicts)

    preview = asyncio.run(
        schedule_bulk._preflight_location_conflicts(schedules, new_drive_time=30)
    )

    assert preview == [{
        "schedule_id": "sched-2",
        "date": "2026-04-22",
        "conflicts": [{"id": "existing-1"}],
    }]
