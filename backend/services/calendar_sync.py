"""Calendar event synchronization for Outlook and Google Calendar.

Handles fire-and-forget creation and deletion of calendar events for
both providers. All operations are enqueued as background tasks.
"""

import asyncio
import logging

from database import db
from core.logger import get_logger

logger = get_logger(__name__)
_outlook_logger = logging.getLogger("outlook.enqueue")

# Tracks fire-and-forget asyncio tasks to prevent garbage collection.
# Awaited during graceful shutdown via server.py lifespan.
background_tasks: set = set()


# --- Time helpers ---

def add_minutes_to_time(time_str: str, minutes: int) -> str:
    """Add minutes to a HH:MM time string, returning HH:MM."""
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def subtract_minutes_from_time(time_str: str, minutes: int) -> str:
    """Subtract minutes from a HH:MM time string, returning HH:MM (floors at 00:00)."""
    h, m = map(int, time_str.split(":"))
    total = max(0, h * 60 + m - minutes)
    return f"{total // 60:02d}:{total % 60:02d}"


# --- Outlook ---

def enqueue_outlook_event(
    employee: dict, location: dict, class_doc: dict | None, doc: dict
):
    """Fire-and-forget: enqueue Outlook event creation if configured."""
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED

    if not OUTLOOK_CALENDAR_ENABLED or not employee.get("email"):
        return

    task = asyncio.ensure_future(
        _enqueue_outlook_event_async(employee, location, class_doc, doc)
    )
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)


async def _enqueue_outlook_event_async(employee, location, class_doc, doc):
    try:
        from core.queue import get_redis_pool

        pool = await get_redis_pool()
        if pool:
            subject = f"{class_doc['name'] if class_doc else 'Class'} - {location['city_name']}"
            await pool.enqueue_job(
                "create_outlook_event",
                schedule_id=doc["id"],
                email=employee["email"],
                subject=subject,
                location_name=location["city_name"],
                date=doc["date"],
                start_time=doc["start_time"],
                end_time=doc["end_time"],
                notes=doc.get("notes", ""),
                employee_id=employee["id"],
            )
    except (OSError, RuntimeError):
        _outlook_logger.exception("Failed to enqueue Outlook event creation")


async def enqueue_outlook_delete_single(emp: dict, event_id: str):
    """Delete a single Outlook event for an employee."""
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    if not OUTLOOK_CALENDAR_ENABLED or not event_id or not emp.get("email"):
        return
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool:
            await pool.enqueue_job(
                "delete_outlook_event",
                email=emp["email"],
                event_id=event_id,
                employee_id=emp.get("id", ""),
            )
    except (OSError, RuntimeError):
        _outlook_logger.exception("Failed to enqueue Outlook event deletion")


async def enqueue_outlook_delete_legacy(schedule: dict):
    """Legacy: delete Outlook event using top-level outlook_event_id."""
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    outlook_event_id = schedule.get("outlook_event_id")
    if not OUTLOOK_CALENDAR_ENABLED or not outlook_event_id:
        return
    emp_id = schedule.get("employee_id") or (schedule.get("employee_ids") or [None])[0]
    if not emp_id:
        return
    emp = await db.employees.find_one({"id": emp_id}, {"_id": 0})
    if not emp or not emp.get("email"):
        return
    await enqueue_outlook_delete_single(emp, outlook_event_id)


# --- Google Calendar ---

async def _fetch_refresh_token(employee_id: str) -> str | None:
    """Fetch only the Google refresh token for an employee."""
    doc = await db.employees.find_one(
        {"id": employee_id},
        {"google_refresh_token": 1},
    )
    raw = doc.get("google_refresh_token") if doc else None
    if raw:
        from core.token_vault import decrypt_token
        return decrypt_token(raw)
    return None


def enqueue_google_event(
    employee: dict, location: dict, class_doc: dict | None, doc: dict
):
    """Fire-and-forget: create Google Calendar event if configured."""
    from core.google_config import GOOGLE_CALENDAR_ENABLED

    if not GOOGLE_CALENDAR_ENABLED or not employee.get("google_calendar_connected"):
        return

    google_email = employee.get("google_calendar_email") or employee.get("email")
    if not google_email:
        return

    schedule_id = doc["id"]
    employee_id = employee["id"]
    class_name = class_doc['name'] if class_doc else 'Class'
    city_name = location["city_name"]
    subject = f"{class_name} - {city_name}"

    drive_to = doc.get("drive_to_override_minutes") or doc.get("drive_time_minutes") or 0
    drive_from = doc.get("drive_from_override_minutes") or doc.get("drive_time_minutes") or 0

    task = asyncio.ensure_future(
        _create_google_events_with_drive_time(
            schedule_id=schedule_id,
            employee_id=employee_id,
            google_email=google_email,
            subject=subject,
            location_name=city_name,
            date=doc["date"],
            start_time=doc["start_time"],
            end_time=doc["end_time"],
            notes=doc.get("notes") or "",
            drive_to=drive_to,
            drive_from=drive_from,
        )
    )
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)


async def _create_google_events_with_drive_time(
    *, schedule_id, employee_id, google_email, subject,
    location_name, date, start_time, end_time, notes,
    drive_to, drive_from,
):
    """Create class event plus separate drive-time events on Google Calendar."""
    event_ids = []

    if drive_to > 0:
        drive_to_start = subtract_minutes_from_time(start_time, drive_to)
        eid = await _try_create_event(
            employee_id, google_email,
            f"Drive to {location_name} ({drive_to} min)",
            location_name, date, drive_to_start, start_time, None,
        )
        if eid:
            event_ids.append(eid)

    main_eid = await _try_create_event(
        employee_id, google_email, subject,
        location_name, date, start_time, end_time, notes,
    )
    if main_eid:
        event_ids.append(main_eid)

    if drive_from > 0:
        drive_from_end = add_minutes_to_time(end_time, drive_from)
        eid = await _try_create_event(
            employee_id, google_email,
            f"Drive from {location_name} ({drive_from} min)",
            location_name, date, end_time, drive_from_end, None,
        )
        if eid:
            event_ids.append(eid)

    if event_ids:
        cal_data = {
            "google_calendar_event_id": event_ids[0],
            "google_calendar_event_ids": event_ids,
        }
        await db.schedules.update_one(
            {"id": schedule_id},
            {"$set": {f"calendar_events.{employee_id}": cal_data}},
        )


async def _try_create_event(
    employee_id, google_email, subject, location_name,
    date, start_time, end_time, notes,
):
    """Fetch credentials and create event. Isolates sensitive data."""
    try:
        from services.google_calendar import create_google_event as _create

        token = await _fetch_refresh_token(employee_id)
        creds = {"google_refresh_token": token} if token else None
        return await _create(
            google_email, subject, location_name,
            date, start_time, end_time,
            notes or None, employee=creds,
        )
    except Exception:
        return None


async def enqueue_google_delete_legacy(schedule: dict, employee_ids: list):
    """Legacy: delete Google events using top-level event IDs."""
    from core.google_config import GOOGLE_CALENDAR_ENABLED
    if not GOOGLE_CALENDAR_ENABLED:
        return

    event_ids = list(schedule.get("google_calendar_event_ids") or [])
    legacy_id = schedule.get("google_calendar_event_id")
    if legacy_id and legacy_id not in event_ids:
        event_ids.append(legacy_id)
    if not event_ids:
        return

    emp_id = schedule.get("employee_id") or (employee_ids[0] if employee_ids else None)
    if not emp_id:
        return
    emp = await db.employees.find_one(
        {"id": emp_id},
        {"email": 1, "google_calendar_email": 1},
    )
    if not emp or not emp.get("email"):
        return
    google_email = emp.get("google_calendar_email") or emp["email"]
    for eid in event_ids:
        await _try_delete_event(emp_id, google_email, eid)


async def _try_delete_event(employee_id, google_email, event_id):
    """Fetch credentials and delete event. Isolates sensitive data."""
    try:
        from services.google_calendar import delete_google_event as _del

        token = await _fetch_refresh_token(employee_id)
        creds = {"google_refresh_token": token} if token else None
        return await _del(google_email, event_id, employee=creds)
    except Exception:
        return False


# --- Coordination ---

def enqueue_calendar_events_for_all(
    employees: list[dict], location: dict, class_doc: dict | None, doc: dict
):
    """Create calendar events for ALL employees on a schedule."""
    for employee in employees:
        enqueue_outlook_event(employee, location, class_doc, doc)
        enqueue_google_event(employee, location, class_doc, doc)


async def delete_employee_calendar_events(emp_id: str, events: dict):
    """Delete all calendar events (Outlook + Google) for a single employee."""
    emp = await db.employees.find_one(
        {"id": emp_id},
        {"_id": 0, "email": 1, "google_calendar_email": 1},
    )
    if not emp:
        return
    outlook_eid = events.get("outlook_event_id")
    if outlook_eid:
        await enqueue_outlook_delete_single(emp, outlook_eid)
    google_eids = list(events.get("google_calendar_event_ids") or [])
    legacy_gid = events.get("google_calendar_event_id")
    if legacy_gid and legacy_gid not in google_eids:
        google_eids.append(legacy_gid)
    google_email = emp.get("google_calendar_email") or emp.get("email")
    for geid in google_eids:
        await _try_delete_event(emp_id, google_email, geid)


async def delete_calendar_events_for_all(schedule: dict):
    """Delete calendar events for ALL employees on a schedule."""
    calendar_events = schedule.get("calendar_events") or {}
    employee_ids = schedule.get("employee_ids") or []

    if calendar_events:
        for emp_id, events in calendar_events.items():
            await delete_employee_calendar_events(emp_id, events)
    else:
        await enqueue_outlook_delete_legacy(schedule)
        await enqueue_google_delete_legacy(schedule, employee_ids)
