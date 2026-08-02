import asyncio
import inspect

import pytest

from services.worker_jobs import (
    CalendarProviderAdapter,
    create_calendar_event_idempotent,
    delete_calendar_event,
    run_for_employees,
)


class FakeCollection:
    def __init__(self, schedule_doc=None):
        self.schedule_doc = schedule_doc or {}
        self.updated = None

    async def find_one(self, query, projection):
        await asyncio.sleep(0)
        if query.get("id") == self.schedule_doc.get("id"):
            return self.schedule_doc
        return None

    async def update_one(self, query, update):
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
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
        await asyncio.sleep(0)
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
        ))


def test_create_persists_mapping():
    db = FakeDb({"id": "s1", "calendar_events": {}})

    async def provider_create(*args, **kwargs):
        await asyncio.sleep(0)
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
    ))

    assert result == {"status": "created", "event_id": "evt-new"}
    assert db.schedules.updated == (
        {"id": "s1"},
        {"$set": {"calendar_events.e1.outlook_event_id": "evt-new"}},
    )


# Regression guard for the real-provider-signature crash: the helper used to
# forward an ``idempotency_key`` kwarg that none of the real provider functions
# (services.outlook.*, services.google_calendar.*) accept, so every worker
# calendar job raised TypeError before reaching the provider. The previous tests
# hid this by stubbing providers with ``**kwargs``. These stubs mirror the real
# signatures exactly (positional event fields + ``employee=``, NO ``**kwargs``),
# so a reintroduced provider-unknown kwarg would fail here.
async def _real_signature_create(
    email, subject, location, date, start_time, end_time, notes=None, employee=None
):
    await asyncio.sleep(0)
    return "evt-real"


async def _real_signature_delete(email, event_id, employee=None):
    await asyncio.sleep(0)
    return True


def test_create_matches_real_provider_signature():
    db = FakeDb({"id": "s1", "calendar_events": {}})
    result = asyncio.run(create_calendar_event_idempotent(
        db=db,
        adapter=_adapter(_real_signature_create),
        schedule_id="s1",
        email="a@b.com",
        subject="Sub",
        location_name="Loc",
        date="2026-01-01",
        start_time="10:00",
        end_time="11:00",
        employee_id="e1",
    ))
    assert result == {"status": "created", "event_id": "evt-real"}


def test_delete_matches_real_provider_signature():
    db = FakeDb({"id": "s1", "calendar_events": {}})
    adapter = CalendarProviderAdapter(
        name="outlook",
        id_field="outlook_event_id",
        create_event=_real_signature_create,
        delete_event=_real_signature_delete,
    )
    result = asyncio.run(delete_calendar_event(
        db=db,
        adapter=adapter,
        email="a@b.com",
        event_id="evt-1",
        employee_id="e1",
    ))
    assert result is True


def test_helpers_do_not_forward_provider_unknown_kwargs():
    # The real provider functions accept no **kwargs, so the helper must call
    # them with only the parameters they declare. Pin that the helper signatures
    # never regrow an idempotency_key (or any provider-forwarded extra) param.
    for fn in (create_calendar_event_idempotent, delete_calendar_event):
        params = set(inspect.signature(fn).parameters)
        assert "idempotency_key" not in params, (
            f"{fn.__name__} must not take idempotency_key: the real calendar "
            "providers reject it and every worker job would crash"
        )


def test_run_for_employees_continues_after_failure():
    calls = []

    async def runner(employee):
        await asyncio.sleep(0)
        calls.append(employee["id"])
        if employee["id"] == "e1":
            raise RuntimeError("fail once")

    adapter = CalendarProviderAdapter(name="google", id_field="google_calendar_event_id", create_event=runner)
    asyncio.run(run_for_employees(
        adapter=adapter,
        employees=[{"id": "e1"}, {"id": "e2"}],
        runner=runner,
        op_name="create",
    ))

    assert calls == ["e1", "e2"]
