import asyncio
import pytest

from services.worker_jobs import CalendarProviderAdapter, create_calendar_event_idempotent, run_for_employees


class FakeCollection:
    def __init__(self, schedule_doc=None):
        self.schedule_doc = schedule_doc or {}
        self.updated = None

    async def find_one(self, query, projection):
        if query.get("id") == self.schedule_doc.get("id"):
            return self.schedule_doc
        return None

    async def update_one(self, query, update):
        self.updated = (query, update)


class FakeDb:
    def __init__(self, schedule_doc=None):
        self.schedules = FakeCollection(schedule_doc)
        self.employees = FakeCollection({"id": "e1", "name": "Emp"})


def _adapter(create_fn):
    return CalendarProviderAdapter(name="outlook", id_field="outlook_event_id", create_event=create_fn)


def test_idempotent_create_skips_when_already_mapped():
    db = FakeDb({"id": "s1", "calendar_events": {"e1": {"outlook_event_id": "evt-1"}}})

    async def provider_create(*args, **kwargs):
        raise AssertionError("provider should not be called when mapped")

    result = asyncio.run(create_calendar_event_idempotent(
        db=db,
        adapter=_adapter(provider_create),
        schedule_id="s1",
        email="a@b.com",
        subject="Sub",
        location_name="Loc",
        date="2026-01-01",
        start_time="10:00",
        end_time="11:00",
        employee_id="e1",
    ))
    assert result["status"] == "skipped"


def test_create_propagates_exception_for_retry_behavior():
    db = FakeDb({"id": "s1", "calendar_events": {}})

    async def provider_create(*args, **kwargs):
        raise RuntimeError("temporary provider outage")

    with pytest.raises(RuntimeError):
        asyncio.run(create_calendar_event_idempotent(
            db=db,
            adapter=_adapter(provider_create),
            schedule_id="s1",
            email="a@b.com",
            subject="Sub",
            location_name="Loc",
            date="2026-01-01",
            start_time="10:00",
            end_time="11:00",
            employee_id="e1",
            idempotency_key="sched:s1:e1",
        ))


def test_create_persists_mapping_and_passes_idempotency_key():
    db = FakeDb({"id": "s1", "calendar_events": {}})
    captured = {}

    async def provider_create(*args, **kwargs):
        captured["idempotency_key"] = kwargs.get("idempotency_key")
        return "evt-new"

    result = asyncio.run(create_calendar_event_idempotent(
        db=db,
        adapter=_adapter(provider_create),
        schedule_id="s1",
        email="a@b.com",
        subject="Sub",
        location_name="Loc",
        date="2026-01-01",
        start_time="10:00",
        end_time="11:00",
        employee_id="e1",
        idempotency_key="sched:s1:e1",
    ))

    assert result == {"status": "created", "event_id": "evt-new"}
    assert captured["idempotency_key"] == "sched:s1:e1"
    assert db.schedules.updated == (
        {"id": "s1"},
        {"$set": {"calendar_events.e1.outlook_event_id": "evt-new"}},
    )


def test_run_for_employees_continues_after_failure():
    calls = []

    async def runner(employee):
        calls.append(employee["id"])
        if employee["id"] == "e1":
            raise RuntimeError("fail once")

    adapter = CalendarProviderAdapter(name="google", id_field="google_calendar_event_id", create_event=runner)
    asyncio.run(run_for_employees(
        db=None,
        adapter=adapter,
        employees=[{"id": "e1"}, {"id": "e2"}],
        runner=runner,
        op_name="create",
    ))

    assert calls == ["e1", "e2"]
