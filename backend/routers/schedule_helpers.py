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
        "calendar_events": {},
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
