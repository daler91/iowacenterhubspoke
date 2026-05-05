from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from core.logger import get_logger

logger = get_logger("Worker")

CreateFn = Callable[..., Awaitable[str | None]]
UpdateFn = Callable[..., Awaitable[bool]]
DeleteFn = Callable[..., Awaitable[bool]]


@dataclass(frozen=True)
class CalendarProviderAdapter:
    """Provider contract for employee-scoped calendar operations."""

    name: str
    id_field: str
    create_event: CreateFn
    update_event: UpdateFn | None = None
    delete_event: DeleteFn | None = None


async def _load_employee(db, employee_id: str) -> dict | None:
    if not employee_id:
        return None
    return await db.employees.find_one({"id": employee_id}, {"_id": 0})


async def _get_existing_event_id(db, schedule_id: str, employee_id: str, field: str) -> str | None:
    existing = await db.schedules.find_one(
        {"id": schedule_id}, {"_id": 0, "calendar_events": 1, field: 1}
    )
    if not existing:
        return None
    if employee_id:
        return (existing.get("calendar_events") or {}).get(employee_id, {}).get(field)
    return existing.get(field)


async def _persist_event_mapping(db, *, schedule_id: str, employee_id: str, field: str, event_id: str) -> None:
    update_key = f"calendar_events.{employee_id}.{field}" if employee_id else field
    await db.schedules.update_one({"id": schedule_id}, {"$set": {update_key: event_id}})


async def run_for_employees(
    *,
    db,
    adapter: CalendarProviderAdapter,
    employees: list[dict],
    runner: Callable[[dict], Awaitable[None]],
    op_name: str,
) -> None:
    """Centralized employee fan-out with consistent error handling."""
    for employee in employees:
        try:
            await runner(employee)
        except Exception:
            logger.exception("%s failed for provider=%s employee_id=%s", op_name, adapter.name, employee.get("id"))


async def create_calendar_event_idempotent(
    *,
    db,
    adapter: CalendarProviderAdapter,
    schedule_id: str,
    email: str,
    subject: str,
    location_name: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str = "",
    employee_id: str = "",
    idempotency_key: str = "",
):
    existing_event_id = await _get_existing_event_id(db, schedule_id, employee_id, adapter.id_field)
    if existing_event_id:
        return {"status": "skipped", "reason": "already_mapped", "event_id": existing_event_id}

    employee = await _load_employee(db, employee_id)
    event_id = await adapter.create_event(
        email,
        subject,
        location_name,
        date,
        start_time,
        end_time,
        notes or None,
        employee=employee,
        idempotency_key=idempotency_key or None,
    )
    if not event_id:
        return {"status": "no_event_id"}

    await _persist_event_mapping(
        db,
        schedule_id=schedule_id,
        employee_id=employee_id,
        field=adapter.id_field,
        event_id=event_id,
    )
    return {"status": "created", "event_id": event_id}


async def delete_calendar_event(
    *, db, adapter: CalendarProviderAdapter, email: str, event_id: str, employee_id: str = "", idempotency_key: str = ""
):
    if adapter.delete_event is None:
        raise ValueError(f"Provider {adapter.name} does not support delete")
    employee = await _load_employee(db, employee_id)
    return await adapter.delete_event(email, event_id, employee=employee, idempotency_key=idempotency_key or None)
