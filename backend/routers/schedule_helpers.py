"""Shared constants, helpers, imports, and Outlook helpers used across schedule sub-routers."""

import uuid
import logging
from datetime import datetime, timezone

from fastapi import HTTPException

from database import db
from models.schemas import ScheduleCreate
from routers.classes import get_class_snapshot
from services.drive_time import get_drive_time_between_locations
from core.logger import get_logger
from core.constants import STATUS_UPCOMING

logger = get_logger(__name__)

SCHEDULE_NOT_FOUND = "Schedule not found"
LOCATION_NOT_FOUND = "Location not found"
EMPLOYEE_NOT_FOUND = "Employee not found"
CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

HUB_LABEL = "Hub (Des Moines)"

_background_tasks: set = set()
_outlook_logger = logging.getLogger("outlook.enqueue")
_google_logger = logging.getLogger("google_calendar.enqueue")


# --- Outlook helpers ---

def _enqueue_outlook_event(
    employee: dict, location: dict, class_doc: dict | None, doc: dict
):
    """Fire-and-forget: enqueue Outlook event creation if configured."""
    from core.outlook_config import OUTLOOK_ENABLED

    if not OUTLOOK_ENABLED or not employee.get("email"):
        return
    import asyncio

    task = asyncio.ensure_future(
        _enqueue_outlook_event_async(employee, location, class_doc, doc)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


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
            )
    except Exception:
        _outlook_logger.exception("Failed to enqueue Outlook event creation")


async def _enqueue_outlook_delete(schedule: dict):
    """Fire-and-forget: enqueue Outlook event deletion if applicable."""
    from core.outlook_config import OUTLOOK_ENABLED

    outlook_event_id = schedule.get("outlook_event_id")
    if not OUTLOOK_ENABLED or not outlook_event_id:
        return
    employee = await db.employees.find_one(
        {"id": schedule["employee_id"]}, {"_id": 0}
    )
    if not employee or not employee.get("email"):
        return
    try:
        from core.queue import get_redis_pool

        pool = await get_redis_pool()
        if pool:
            await pool.enqueue_job(
                "delete_outlook_event",
                email=employee["email"],
                event_id=outlook_event_id,
            )
    except Exception:
        _outlook_logger.exception("Failed to enqueue Outlook event deletion")


# --- Google Calendar helpers ---

def _enqueue_google_event(
    employee: dict, location: dict, class_doc: dict | None, doc: dict
):
    """Fire-and-forget: enqueue Google Calendar event creation if configured."""
    from core.google_config import GOOGLE_CALENDAR_ENABLED

    if not GOOGLE_CALENDAR_ENABLED or not employee.get("email"):
        return
    import asyncio

    task = asyncio.ensure_future(
        _enqueue_google_event_async(employee, location, class_doc, doc)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _enqueue_google_event_async(employee, location, class_doc, doc):
    try:
        from core.queue import get_redis_pool

        pool = await get_redis_pool()
        if pool:
            subject = f"{class_doc['name'] if class_doc else 'Class'} - {location['city_name']}"
            await pool.enqueue_job(
                "create_google_event",
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
    except Exception:
        _google_logger.exception("Failed to enqueue Google Calendar event creation")


async def _enqueue_google_delete(schedule: dict):
    """Fire-and-forget: enqueue Google Calendar event deletion if applicable."""
    from core.google_config import GOOGLE_CALENDAR_ENABLED

    google_event_id = schedule.get("google_calendar_event_id")
    if not GOOGLE_CALENDAR_ENABLED or not google_event_id:
        return
    employee = await db.employees.find_one(
        {"id": schedule["employee_id"]}, {"_id": 0}
    )
    if not employee or not employee.get("email"):
        return
    try:
        from core.queue import get_redis_pool

        pool = await get_redis_pool()
        if pool:
            await pool.enqueue_job(
                "delete_google_event",
                email=employee["email"],
                event_id=google_event_id,
                employee_id=employee["id"],
            )
    except Exception:
        _google_logger.exception("Failed to enqueue Google Calendar event deletion")


# --- Time helpers ---

def _add_minutes_to_time(time_str: str, minutes: int) -> str:
    """Add minutes to a HH:MM time string, returning HH:MM."""
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _subtract_minutes_from_time(time_str: str, minutes: int) -> str:
    """Subtract minutes from a HH:MM time string, returning HH:MM (floors at 00:00)."""
    h, m = map(int, time_str.split(":"))
    total = max(0, h * 60 + m - minutes)
    return f"{total // 60:02d}:{total % 60:02d}"


# --- Town-to-town helpers ---

async def _check_town_to_town(employee_id, sched_date, location_id):
    same_day_schedules = await db.schedules.find(
        {
            "employee_id": employee_id,
            "date": sched_date,
            "location_id": {"$ne": location_id},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(100)

    if not same_day_schedules:
        return False, None, None

    location_ids = list({s["location_id"] for s in same_day_schedules})
    other_locations = await db.locations.find(
        {"id": {"$in": location_ids}}, {"_id": 0}
    ).to_list(100)
    loc_map = {loc["id"]: loc for loc in other_locations}

    other_cities = []
    drive_minutes = None
    for s in same_day_schedules:
        if s["location_id"] in loc_map:
            other_cities.append(loc_map[s["location_id"]]["city_name"])

    for other_loc_id in location_ids:
        try:
            minutes = await get_drive_time_between_locations(location_id, other_loc_id)
            if minutes is not None:
                if drive_minutes is None or minutes < drive_minutes:
                    drive_minutes = minutes
        except Exception:
            logger.warning(
                "Failed to get drive time between %s and %s",
                location_id, other_loc_id, exc_info=True,
            )

    if drive_minutes is not None:
        warning = (
            f"Town-to-Town Travel: ~{drive_minutes} min drive between locations. "
            f"Other locations: {', '.join(other_cities)}"
        )
    else:
        warning = (
            "Town-to-Town Travel Detected: Verify drive time manually. "
            f"Other locations: {', '.join(other_cities)}"
        )
    return True, warning, drive_minutes


def _build_ttt_warning(drive_minutes, other_cities):
    city_list = ", ".join(other_cities)
    if drive_minutes is not None:
        return (
            f"Town-to-Town Travel: ~{drive_minutes} min drive between locations. "
            f"Other locations: {city_list}"
        )
    return (
        "Town-to-Town Travel Detected: Verify drive time manually. "
        f"Other locations: {city_list}"
    )


async def _compute_min_drive_time(location_id, scheds, cache):
    drive_minutes = None
    for s in scheds:
        other_id = s["location_id"]
        pair_key = tuple(sorted([location_id, other_id]))
        if pair_key not in cache:
            try:
                cache[pair_key] = await get_drive_time_between_locations(location_id, other_id)
            except Exception:
                cache[pair_key] = None
        m = cache[pair_key]
        if m is not None and (drive_minutes is None or m < drive_minutes):
            drive_minutes = m
    return drive_minutes


async def _check_town_to_town_bulk(
    employee_id: str, dates: list[str], location_id: str
):
    same_day_schedules = await db.schedules.find(
        {
            "employee_id": employee_id,
            "date": {"$in": dates},
            "location_id": {"$ne": location_id},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(10000)

    from collections import defaultdict

    schedules_by_date = defaultdict(list)
    for s in same_day_schedules:
        schedules_by_date[s["date"]].append(s)

    location_ids = list({s["location_id"] for s in same_day_schedules})
    if not location_ids:
        return {}

    other_locations = await db.locations.find(
        {"id": {"$in": location_ids}}, {"_id": 0}
    ).to_list(1000)
    loc_map = {loc["id"]: loc for loc in other_locations}

    results = {}
    drive_time_cache = {}
    for date, scheds in schedules_by_date.items():
        other_cities = list({
            loc_map[s["location_id"]]["city_name"]
            for s in scheds
            if s["location_id"] in loc_map
        })
        if not other_cities:
            continue
        drive_minutes = await _compute_min_drive_time(location_id, scheds, drive_time_cache)
        warning = _build_ttt_warning(drive_minutes, other_cities)
        results[date] = (True, warning, drive_minutes)

    return results


async def _sync_same_day_town_to_town(
    employee_id: str, date: str, exclude_id: str = None
):
    """Recalculate town-to-town for all sibling schedules on employee+date."""
    query = {"employee_id": employee_id, "date": date, "deleted_at": None}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    siblings = await db.schedules.find(query, {"_id": 0}).to_list(100)

    for sib in siblings:
        tt, tt_warning, tt_drive = await _check_town_to_town(
            employee_id, date, sib["location_id"]
        )
        update = {
            "town_to_town": tt,
            "town_to_town_warning": tt_warning,
            "town_to_town_drive_minutes": tt_drive,
        }
        if not tt:
            update["town_to_town"] = False
            update["town_to_town_warning"] = None
            update["town_to_town_drive_minutes"] = None
        if not sib.get("travel_override_minutes"):
            loc = await db.locations.find_one(
                {"id": sib["location_id"]}, {"_id": 0}
            )
            if loc:
                update["drive_time_minutes"] = loc["drive_time_minutes"]
        await db.schedules.update_one({"id": sib["id"]}, {"$set": update})


# --- Document builder ---

def _build_schedule_doc(
    data,
    sched_date,
    drive_time,
    town_to_town,
    town_to_town_warning,
    recurrence_rule,
    location,
    employee,
    class_doc,
    town_to_town_drive_minutes=None,
):
    return {
        "id": str(uuid.uuid4()),
        "employee_id": data.employee_id,
        "location_id": data.location_id,
        "date": sched_date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "drive_time_minutes": drive_time,
        "town_to_town": town_to_town,
        "town_to_town_warning": town_to_town_warning,
        "town_to_town_drive_minutes": town_to_town_drive_minutes,
        "travel_override_minutes": data.travel_override_minutes,
        "drive_to_override_minutes": data.drive_to_override_minutes,
        "drive_from_override_minutes": data.drive_from_override_minutes,
        "notes": data.notes,
        "status": STATUS_UPCOMING,
        "recurrence": data.recurrence,
        "recurrence_end_mode": data.recurrence_end_mode,
        "recurrence_end_date": data.recurrence_end_date,
        "recurrence_occurrences": data.recurrence_occurrences,
        "recurrence_rule": (
            recurrence_rule.model_dump() if recurrence_rule else None
        ),
        "location_name": location["city_name"],
        "employee_name": employee["name"],
        "employee_color": employee.get("color", "#4F46E5"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
        **get_class_snapshot(class_doc),
    }


async def _fetch_schedule_entities(data: ScheduleCreate):
    location = await db.locations.find_one(
        {"id": data.location_id, "deleted_at": None}, {"_id": 0}
    )
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    employee = await db.employees.find_one(
        {"id": data.employee_id, "deleted_at": None}, {"_id": 0}
    )
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    class_doc = None
    if data.class_id:
        class_doc = await db.classes.find_one(
            {"id": data.class_id, "deleted_at": None}, {"_id": 0}
        )
        if not class_doc:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    return location, employee, class_doc
