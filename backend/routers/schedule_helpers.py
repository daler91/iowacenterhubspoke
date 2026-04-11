"""Shared constants, entity fetchers, and document builder for schedule sub-routers.

Calendar sync and town-to-town logic have been extracted to:
  - services.calendar_sync (Outlook + Google Calendar operations)
  - services.town_to_town (inter-location travel detection)
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from database import db
from models.schemas import ScheduleCreate
from routers.classes import get_class_snapshot
from core.logger import get_logger
from core.constants import STATUS_UPCOMING, DEFAULT_EMPLOYEE_COLOR

logger = get_logger(__name__)

# --- Error messages ---
SCHEDULE_NOT_FOUND = "Schedule not found"
LOCATION_NOT_FOUND = "Location not found"
EMPLOYEE_NOT_FOUND = "Employee not found"
CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

HUB_LABEL = "Hub (Des Moines)"

# Re-export background_tasks for graceful shutdown in server.py
from services.calendar_sync import background_tasks as _background_tasks  # noqa: E402, F401

# Re-export calendar and town-to-town functions for existing consumers.
# These are the public API that other schedule routers import.
from services.calendar_sync import (  # noqa: E402, F401
    enqueue_calendar_events_for_all as _enqueue_calendar_events_for_all,
    delete_calendar_events_for_all as _delete_calendar_events_for_all,
    delete_employee_calendar_events as _delete_employee_calendar_events,
    enqueue_outlook_event as _enqueue_outlook_event,
    enqueue_google_event as _enqueue_google_event,
    add_minutes_to_time as _add_minutes_to_time,
    subtract_minutes_from_time as _subtract_minutes_from_time,
)
from services.town_to_town import (  # noqa: E402, F401
    check_town_to_town as _check_town_to_town,
    check_town_to_town_bulk as _check_town_to_town_bulk,
    sync_same_day_town_to_town as _sync_same_day_town_to_town,
)


# --- Employee snapshot helpers ---

def _build_employee_snapshot(emp: dict) -> dict:
    """Build a denormalized employee entry for the employees array."""
    return {
        "id": emp["id"],
        "name": emp["name"],
        "color": emp.get("color", DEFAULT_EMPLOYEE_COLOR),
    }


def _build_employees_snapshot(employees: list[dict]) -> list[dict]:
    """Build the denormalized employees array."""
    return [_build_employee_snapshot(e) for e in employees]


# --- Document builder ---

def _build_schedule_doc(
    data,
    sched_date,
    drive_time,
    town_to_town,
    town_to_town_warning,
    recurrence_rule,
    location,
    employees,
    class_doc,
    town_to_town_drive_minutes=None,
    series_id=None,
):
    """Build a schedule document with multiple employees."""
    employee_ids = [e["id"] for e in employees]
    return {
        "id": str(uuid.uuid4()),
        "employee_ids": employee_ids,
        "employees": _build_employees_snapshot(employees),
        "location_id": data.location_id,
        "date": sched_date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "drive_time_minutes": drive_time,
        "town_to_town": town_to_town,
        "town_to_town_warning": town_to_town_warning,
        "town_to_town_drive_minutes": town_to_town_drive_minutes,
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
        "calendar_events": {},
        "series_id": series_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
        **get_class_snapshot(class_doc),
    }


# --- Entity fetchers ---

async def _fetch_employee(employee_id: str):
    """Fetch and validate a single employee."""
    employee = await db.employees.find_one(
        {"id": employee_id, "deleted_at": None}, {"_id": 0}
    )
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    return employee


async def _fetch_employees(employee_ids: list[str]):
    """Fetch and validate multiple employees."""
    employees = await db.employees.find(
        {"id": {"$in": employee_ids}, "deleted_at": None}, {"_id": 0}
    ).to_list(len(employee_ids))
    if len(employees) != len(employee_ids):
        found_ids = {e["id"] for e in employees}
        missing = [eid for eid in employee_ids if eid not in found_ids]
        raise HTTPException(
            status_code=404,
            detail=f"Employee(s) not found: {', '.join(missing)}"
        )
    emp_map = {e["id"]: e for e in employees}
    return [emp_map[eid] for eid in employee_ids]


async def _fetch_location_and_class(data: ScheduleCreate):
    """Fetch and validate location and optional class."""
    location = await db.locations.find_one(
        {"id": data.location_id, "deleted_at": None}, {"_id": 0}
    )
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    class_doc = None
    if data.class_id:
        class_doc = await db.classes.find_one(
            {"id": data.class_id, "deleted_at": None}, {"_id": 0}
        )
        if not class_doc:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    return location, class_doc


async def _fetch_schedule_entities(data: ScheduleCreate):
    """Fetch location, employees, and class for a schedule creation request."""
    location, class_doc = await _fetch_location_and_class(data)
    employees = await _fetch_employees(data.employee_ids)
    return location, employees, class_doc


# --- Update helpers ---
#
# These used to live inside ``routers/schedule_crud.py`` and were imported
# back into ``update_series`` via a circular-import workaround. Lifting them
# here lets both ``schedule_crud.update_schedule`` and
# ``schedule_crud.update_series`` call them directly, and shrinks the CRUD
# router back below ~500 lines.


async def _resolve_location_update(location_id: str, update_data: dict):
    location = await db.locations.find_one({"id": location_id}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    update_data["location_name"] = location["city_name"]
    # ``_handle_drive_overrides`` may replace this with the per-leg override
    # below; absent an override the location's default drive time wins.
    update_data["drive_time_minutes"] = location["drive_time_minutes"]


async def _resolve_class_update(class_id: str, update_data: dict):
    class_doc = await db.classes.find_one({"id": class_id}, {"_id": 0})
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)
    update_data.update(
        {
            "class_name": class_doc["name"],
            "class_color": class_doc.get("color", "#0F766E"),
            "class_description": class_doc.get("description"),
        }
    )


async def _handle_drive_overrides(schedule_id: str, update_data: dict):
    location_id = update_data.get("location_id")
    if not location_id:
        existing = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
        if existing:
            location_id = existing.get("location_id")

    loc = None
    if location_id:
        loc = await db.locations.find_one({"id": location_id}, {"_id": 0})

    if "drive_to_override_minutes" in update_data:
        if update_data["drive_to_override_minutes"]:
            update_data["drive_time_minutes"] = update_data["drive_to_override_minutes"]
        elif loc:
            update_data["drive_time_minutes"] = loc["drive_time_minutes"]


async def resolve_update_relations(schedule_id: str, update_data: dict):
    """Resolve location, employee, class, and drive override relations for an update.

    Mutates ``update_data`` in-place so the caller can pass it straight into
    ``db.schedules.update_one``. Raises 404 if a referenced location, employee,
    or class is missing (matching the pre-extraction behavior).
    """
    if "location_id" in update_data:
        await _resolve_location_update(update_data["location_id"], update_data)
    if "employee_ids" in update_data:
        employees = await _fetch_employees(update_data["employee_ids"])
        update_data["employees"] = _build_employees_snapshot(employees)
        update_data.pop("employee_id", None)
        update_data.pop("employee_name", None)
        update_data.pop("employee_color", None)
    if "class_id" in update_data:
        await _resolve_class_update(update_data["class_id"], update_data)
    if (
        "drive_to_override_minutes" in update_data
        or "drive_from_override_minutes" in update_data
    ):
        await _handle_drive_overrides(schedule_id, update_data)


async def sync_town_to_town_if_needed(schedule_id: str, update_data: dict):
    """Recalculate town-to-town flags if relevant fields changed."""
    recalc_fields = {"location_id", "date", "employee_ids"}
    if not (recalc_fields & update_data.keys()):
        return
    updated_sched = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not updated_sched:
        return
    for emp_id in updated_sched.get("employee_ids", []):
        await _sync_same_day_town_to_town(emp_id, updated_sched["date"])


async def sync_calendar_events_if_needed(
    schedule_id: str, update_data: dict, old_schedule: dict,
):
    """Delete old and create new calendar events if calendar-relevant fields changed."""
    calendar_fields = {
        "employee_ids", "location_id", "class_id", "date",
        "start_time", "end_time", "notes",
        "drive_to_override_minutes", "drive_from_override_minutes",
        "drive_time_minutes",
    }
    if not (calendar_fields & update_data.keys()):
        return
    updated_sched = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not updated_sched:
        return
    await _delete_calendar_events_for_all(old_schedule)
    employees = await _fetch_employees(updated_sched.get("employee_ids", []))
    location = await db.locations.find_one(
        {"id": updated_sched["location_id"], "deleted_at": None}, {"_id": 0}
    )
    class_doc = None
    if updated_sched.get("class_id"):
        class_doc = await db.classes.find_one(
            {"id": updated_sched["class_id"], "deleted_at": None}, {"_id": 0}
        )
    if employees and location:
        _enqueue_calendar_events_for_all(employees, location, class_doc, updated_sched)


async def sync_relocate_calendar(old_schedule: dict, updated: dict):
    """Re-create calendar events after a relocate."""
    if not updated:
        return
    await _delete_calendar_events_for_all(old_schedule)
    employees = await _fetch_employees(updated.get("employee_ids", []))
    location = await db.locations.find_one(
        {"id": updated["location_id"], "deleted_at": None}, {"_id": 0}
    )
    class_doc = None
    if updated.get("class_id"):
        class_doc = await db.classes.find_one(
            {"id": updated["class_id"], "deleted_at": None}, {"_id": 0}
        )
    if employees and location:
        _enqueue_calendar_events_for_all(employees, location, class_doc, updated)
