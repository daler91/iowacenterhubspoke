from core.logger import get_logger

logger = get_logger("Worker")


async def create_calendar_event_idempotent(
    *,
    db,
    provider_create,
    provider_name: str,
    schedule_id: str,
    email: str,
    subject: str,
    location_name: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str = "",
    employee_id: str = "",
):
    field = "outlook_event_id" if provider_name == "outlook" else "google_calendar_event_id"
    existing = await db.schedules.find_one(
        {"id": schedule_id}, {"_id": 0, "calendar_events": 1, field: 1}
    )
    if existing:
        mapped = (
            (existing.get("calendar_events") or {}).get(employee_id, {}).get(field)
            if employee_id
            else existing.get(field)
        )
        if mapped:
            return {"status": "skipped", "reason": "already_mapped", "event_id": mapped}

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    event_id = await provider_create(
        email,
        subject,
        location_name,
        date,
        start_time,
        end_time,
        notes or None,
        employee=employee,
    )
    if not event_id:
        return {"status": "no_event_id"}

    update_key = f"calendar_events.{employee_id}.{field}" if employee_id else field
    await db.schedules.update_one({"id": schedule_id}, {"$set": {update_key: event_id}})
    return {"status": "created", "event_id": event_id}


async def delete_calendar_event(*, db, provider_delete, email: str, event_id: str, employee_id: str = ""):
    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    return await provider_delete(email, event_id, employee=employee)
