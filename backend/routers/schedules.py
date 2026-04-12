import uuid
import csv
import io
from fastapi.responses import StreamingResponse
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, UploadFile, File

import re as python_re


def _validate_import_row(
    row_clean, date_regex, time_regex, emp_by_email, loc_by_name, class_by_name
):
    row_errors = []

    date = row_clean.get("date", "")
    start_time = row_clean.get("start_time", "")
    end_time = row_clean.get("end_time", "")
    emp_email = row_clean.get("employee_email", "").lower()
    loc_name = row_clean.get("location_name", "").lower()
    class_name = row_clean.get("class_name", "").lower()
    notes = row_clean.get("notes", "")

    if not date or not date_regex.match(date):
        row_errors.append(f"Invalid date format '{date}'. Expected YYYY-MM-DD")

    if not start_time or not time_regex.match(start_time):
        row_errors.append(f"Invalid start_time '{start_time}'. Expected HH:MM")

    if not end_time or not time_regex.match(end_time):
        row_errors.append(f"Invalid end_time '{end_time}'. Expected HH:MM")

    employee = emp_by_email.get(emp_email)
    if not employee:
        row_errors.append(f"Employee email '{emp_email}' not found")

    location = loc_by_name.get(loc_name)
    if not location:
        row_errors.append(f"Location '{loc_name}' not found")

    class_obj = None
    if class_name:
        class_obj = class_by_name.get(class_name)
        if not class_obj:
            row_errors.append(f"Class '{class_name}' not found")

    if row_errors:
        return {"errors": row_errors}

    return {
        "valid_data": {
            "employee_id": employee["id"],
            "employee_name": employee["name"],
            "employee_email": employee.get("email", ""),
            "location_id": location["id"],
            "location_name": location["city_name"],
            "class_id": class_obj["id"] if class_obj else None,
            "class_name": class_obj["name"] if class_obj else "",
            "date": date,
            "start_time": start_time,
            "end_time": end_time,
            "notes": notes,
        }
    }


from typing import Annotated, Optional
from database import db
from models.schemas import (
    ScheduleCreate,
    ScheduleImportItem,
    ScheduleUpdate,
    StatusUpdate,
    ScheduleRelocate,
    BulkDeleteRequest,
    BulkStatusUpdateRequest,
    BulkReassignRequest,
    BulkLocationUpdateRequest,
    BulkClassUpdateRequest,
    ErrorResponse,
)
from core.auth import CurrentUser, SchedulerRequired, AdminRequired
from services.activity import log_activity
from routers.classes import get_class_snapshot
from services.schedule_utils import (
    build_recurrence_rule,
    build_recurrence_dates,
    check_conflicts,
    check_outlook_conflicts,
    time_to_minutes,
)
from services.drive_time import get_drive_time_between_locations
from core.logger import get_logger
from core.constants import (
    STATUS_UPCOMING,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    DEFAULT_EMPLOYEE_COLOR,
)

logger = get_logger(__name__)

import logging

router = APIRouter(prefix="/schedules", tags=["schedules"])
_outlook_logger = logging.getLogger("outlook.enqueue")

SCHEDULE_NOT_FOUND = "Schedule not found"
LOCATION_NOT_FOUND = "Location not found"
EMPLOYEE_NOT_FOUND = "Employee not found"
CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


_background_tasks: set = set()


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


@router.get("")
async def get_schedules(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 1000,
):
    query = {"deleted_at": None}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        query["date"] = {"$gte": date_from}
    elif date_to:
        query["date"] = {"$lte": date_to}
    if employee_id:
        query["employee_id"] = employee_id

    total = await db.schedules.count_documents(query)
    schedules = (
        await db.schedules.find(query, {"_id": 0})
        .sort([("date", 1), ("start_time", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    return {"items": schedules, "total": total, "skip": skip, "limit": limit}


@router.post("/bulk-delete")
async def bulk_delete_schedules(
    data: BulkDeleteRequest, user: SchedulerRequired
):
    now = datetime.now(timezone.utc).isoformat()
    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    deleted_count = result.modified_count
    if deleted_count > 0:
        logger.info(
            f"Bulk deleted {deleted_count} schedules",
            extra={"entity": {"deleted_count": deleted_count}},
        )
        await log_activity(
            action="schedule_bulk_deleted",
            description=f"Bulk deleted {deleted_count} schedule(s)",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
    return {"deleted_count": deleted_count}


@router.put(
    "/bulk-status",
    responses={400: {"model": ErrorResponse, "description": "Invalid status"}},
)
async def bulk_update_status(
    data: BulkStatusUpdateRequest, user: SchedulerRequired
):
    if data.status not in [
        STATUS_UPCOMING,
        STATUS_IN_PROGRESS,
        STATUS_COMPLETED,
    ]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {"$set": {"status": data.status}},
    )
    updated_count = result.modified_count
    if updated_count > 0:
        logger.info(
            f"Bulk status update: {updated_count} schedules to {data.status}",
            extra={
                "entity": {
                    "updated_count": updated_count,
                    "status": data.status,
                }
            },
        )
        await log_activity(
            action="schedule_bulk_status",
            description=f"Bulk updated {updated_count} schedule(s) to {data.status.replace('_', ' ')}",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
    return {"updated_count": updated_count}


@router.put(
    "/bulk-reassign",
    responses={
        404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}
    },
)
async def bulk_reassign_schedules(
    data: BulkReassignRequest, user: SchedulerRequired
):
    employee = await db.employees.find_one(
        {"id": data.employee_id, "deleted_at": None}, {"_id": 0}
    )
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {
            "$set": {
                "employee_id": data.employee_id,
                "employee_name": employee["name"],
                "employee_color": employee.get(
                    "color", DEFAULT_EMPLOYEE_COLOR
                ),
            }
        },
    )
    updated_count = result.modified_count
    if updated_count > 0:
        logger.info(
            f"Bulk reassigned {updated_count} schedules to {employee['name']}",
            extra={
                "entity": {
                    "updated_count": updated_count,
                    "employee_id": data.employee_id,
                }
            },
        )
        await log_activity(
            action="schedule_bulk_reassigned",
            description=f"Bulk reassigned {updated_count} schedule(s) to {employee['name']}",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
    return {"updated_count": updated_count}


@router.put(
    "/bulk-location",
    responses={
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}
    },
)
async def bulk_update_location(
    data: BulkLocationUpdateRequest, user: SchedulerRequired
):
    location = await db.locations.find_one(
        {"id": data.location_id, "deleted_at": None}, {"_id": 0}
    )
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {
            "$set": {
                "location_id": data.location_id,
                "location_name": location["city_name"],
                "drive_time_minutes": location["drive_time_minutes"],
                "travel_override_minutes": None,
            }
        },
    )
    updated_count = result.modified_count
    if updated_count > 0:
        logger.info(
            f"Bulk updated {updated_count} schedules to location {location['city_name']}",
            extra={
                "entity": {
                    "updated_count": updated_count,
                    "location_id": data.location_id,
                }
            },
        )
        await log_activity(
            action="schedule_bulk_location",
            description=f"Bulk updated {updated_count} schedule(s) to {location['city_name']}",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
    return {"updated_count": updated_count}


@router.put(
    "/bulk-class",
    responses={404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND}},
)
async def bulk_update_class(
    data: BulkClassUpdateRequest, user: SchedulerRequired
):
    class_doc = await db.classes.find_one(
        {"id": data.class_id, "deleted_at": None}, {"_id": 0}
    )
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {
            "$set": {
                "class_id": data.class_id,
                "class_name": class_doc["name"],
                "class_color": class_doc.get("color", "#0F766E"),
                "class_description": class_doc.get("description"),
            }
        },
    )
    updated_count = result.modified_count
    if updated_count > 0:
        logger.info(
            f"Bulk updated {updated_count} schedules to class {class_doc['name']}",
            extra={
                "entity": {
                    "updated_count": updated_count,
                    "class_id": data.class_id,
                }
            },
        )
        await log_activity(
            action="schedule_bulk_class",
            description=f"Bulk updated {updated_count} schedule(s) to {class_doc['name']}",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
    return {"updated_count": updated_count}


@router.get(
    "/{schedule_id}",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def get_schedule(schedule_id: str, user: CurrentUser):
    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    return schedule


HUB_LABEL = "Hub (Des Moines)"


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


async def _build_travel_chain(
    employee_id: str,
    date: str,
    current_location_id: str,
    current_start: str,
    current_end: str,
    schedule_id: str = None,
    drive_to_override: int = None,
    drive_from_override: int = None,
):
    """Build the full day travel chain for an employee including the current form entry."""
    query = {"employee_id": employee_id, "date": date, "deleted_at": None}
    if schedule_id:
        query["id"] = {"$ne": schedule_id}
    db_schedules = await db.schedules.find(query, {"_id": 0}).to_list(100)

    # Build entries: DB schedules + virtual current entry
    entries = []
    for s in db_schedules:
        entries.append(
            {
                "schedule_id": s["id"],
                "location_id": s["location_id"],
                "location_name": s.get("location_name", "Unknown"),
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "is_current": False,
                "drive_to_override_minutes": s.get("drive_to_override_minutes"),
                "drive_from_override_minutes": s.get("drive_from_override_minutes"),
            }
        )

    # Add the current form entry
    current_loc = await db.locations.find_one(
        {"id": current_location_id}, {"_id": 0}
    )
    current_loc_name = current_loc["city_name"] if current_loc else "Unknown"
    entries.append(
        {
            "schedule_id": schedule_id,
            "location_id": current_location_id,
            "location_name": current_loc_name,
            "start_time": current_start,
            "end_time": current_end,
            "is_current": True,
            "drive_to_override_minutes": drive_to_override,
            "drive_from_override_minutes": drive_from_override,
        }
    )

    # Sort by start time
    entries.sort(key=lambda e: e["start_time"])

    if not entries:
        return None

    # Fetch all unique location docs for hub drive times
    loc_ids = list({e["location_id"] for e in entries})
    locations = await db.locations.find(
        {"id": {"$in": loc_ids}}, {"_id": 0}
    ).to_list(100)
    loc_map = {loc["id"]: loc for loc in locations}

    # Build legs
    legs = []
    total_drive = 0

    # First leg: Hub → first location (arrive by first class start)
    first_entry = entries[0]
    first_loc = loc_map.get(first_entry["location_id"])
    default_first_drive = first_loc["drive_time_minutes"] if first_loc else 0
    first_override = first_entry.get("drive_to_override_minutes")
    first_hub_drive = first_override if first_override else default_first_drive
    is_first_overridden = first_override is not None and first_override > 0
    first_drive_end = first_entry["start_time"]
    first_drive_start = _subtract_minutes_from_time(first_drive_end, first_hub_drive)
    legs.append(
        {
            "type": "drive",
            "from_label": HUB_LABEL,
            "to_label": first_entry["location_name"],
            "minutes": first_hub_drive,
            "start_time": first_drive_start,
            "end_time": first_drive_end,
            "is_overridden": is_first_overridden,
            "override_field": "drive_to",
            "owner_is_current": first_entry["is_current"],
            "owner_schedule_id": first_entry.get("schedule_id"),
        }
    )
    total_drive += first_hub_drive

    for i, entry in enumerate(entries):
        # Class leg
        legs.append(
            {
                "type": "class",
                "location_name": entry["location_name"],
                "start_time": entry["start_time"],
                "end_time": entry["end_time"],
                "is_current": entry["is_current"],
            }
        )

        # Drive to next location (or hub if last)
        if i < len(entries) - 1:
            next_entry = entries[i + 1]
            if entry["location_id"] == next_entry["location_id"]:
                drive_min = 0
                is_overridden = False
            else:
                try:
                    calculated = (
                        await get_drive_time_between_locations(
                            entry["location_id"], next_entry["location_id"]
                        )
                    ) or 0
                except Exception:
                    calculated = 0
                # Check overrides: from_entry's drive_from or to_entry's drive_to
                from_override = entry.get("drive_from_override_minutes")
                to_override = next_entry.get("drive_to_override_minutes")
                if from_override:
                    drive_min = from_override
                    is_overridden = True
                elif to_override:
                    drive_min = to_override
                    is_overridden = True
                else:
                    drive_min = calculated
                    is_overridden = False
            between_start = entry["end_time"]
            between_end = _add_minutes_to_time(between_start, drive_min)
            legs.append(
                {
                    "type": "drive",
                    "from_label": entry["location_name"],
                    "to_label": next_entry["location_name"],
                    "minutes": drive_min,
                    "start_time": between_start,
                    "end_time": between_end,
                    "is_overridden": is_overridden,
                    "override_field": "drive_from",
                    "owner_is_current": entry["is_current"],
                    "owner_schedule_id": entry.get("schedule_id"),
                }
            )
            total_drive += drive_min
        else:
            # Last leg: last location → Hub
            last_loc = loc_map.get(entry["location_id"])
            default_last_drive = last_loc["drive_time_minutes"] if last_loc else 0
            from_override = entry.get("drive_from_override_minutes")
            last_hub_drive = from_override if from_override else default_last_drive
            is_last_overridden = from_override is not None and from_override > 0
            last_drive_start = entry["end_time"]
            last_drive_end = _add_minutes_to_time(last_drive_start, last_hub_drive)
            legs.append(
                {
                    "type": "drive",
                    "from_label": entry["location_name"],
                    "to_label": HUB_LABEL,
                    "minutes": last_hub_drive,
                    "start_time": last_drive_start,
                    "end_time": last_drive_end,
                    "is_overridden": is_last_overridden,
                    "override_field": "drive_from",
                    "owner_is_current": entry["is_current"],
                    "owner_schedule_id": entry.get("schedule_id"),
                }
            )
            total_drive += last_hub_drive

    return {
        "legs": legs,
        "total_drive_minutes": total_drive,
        "class_count": len(entries),
    }


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

    # Calculate actual drive time between this location and the closest other location
    for other_loc_id in location_ids:
        try:
            minutes = await get_drive_time_between_locations(location_id, other_loc_id)
            if minutes is not None:
                if drive_minutes is None or minutes < drive_minutes:
                    drive_minutes = minutes
        except Exception:
            pass

    if drive_minutes is not None:
        warning = f"Town-to-Town Travel: ~{drive_minutes} min drive between locations. Other locations: {', '.join(other_cities)}"
    else:
        warning = f"Town-to-Town Travel Detected: Verify drive time manually. Other locations: {', '.join(other_cities)}"
    return True, warning, drive_minutes


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
    # Cache drive time lookups to avoid redundant API calls
    drive_time_cache = {}
    for date, scheds in schedules_by_date.items():
        other_cities = list({
            loc_map[s["location_id"]]["city_name"]
            for s in scheds
            if s["location_id"] in loc_map
        })
        if other_cities:
            drive_minutes = None
            for s in scheds:
                other_id = s["location_id"]
                pair_key = tuple(sorted([location_id, other_id]))
                if pair_key not in drive_time_cache:
                    try:
                        drive_time_cache[pair_key] = await get_drive_time_between_locations(location_id, other_id)
                    except Exception:
                        drive_time_cache[pair_key] = None
                m = drive_time_cache[pair_key]
                if m is not None and (drive_minutes is None or m < drive_minutes):
                    drive_minutes = m

            if drive_minutes is not None:
                warning = f"Town-to-Town Travel: ~{drive_minutes} min drive between locations. Other locations: {', '.join(other_cities)}"
            else:
                warning = f"Town-to-Town Travel Detected: Verify drive time manually. Other locations: {', '.join(other_cities)}"
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
        # Always restore drive_time_minutes from location (fix any corrupted data)
        if not sib.get("travel_override_minutes"):
            loc = await db.locations.find_one(
                {"id": sib["location_id"]}, {"_id": 0}
            )
            if loc:
                update["drive_time_minutes"] = loc["drive_time_minutes"]
        await db.schedules.update_one({"id": sib["id"]}, {"$set": update})


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
        "travel_override_minutes": data.travel_override_minutes,  # DEPRECATED
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


async def _handle_single_schedule(
    data: ScheduleCreate,
    date_to_schedule: str,
    drive_time: int,
    recurrence_rule: Optional[any],
    location: dict,
    employee: dict,
    class_doc: Optional[dict],
    user: SchedulerRequired,
):
    conflicts = await check_conflicts(
        data.employee_id,
        date_to_schedule,
        data.start_time,
        data.end_time,
        drive_time,
    )
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Schedule conflict detected",
                "conflicts": conflicts,
            },
        )

    # Check Outlook calendar conflicts (blocking with override)
    if not data.force_outlook:
        outlook_conflicts = await check_outlook_conflicts(
            data.employee_id, date_to_schedule, data.start_time, data.end_time
        )
        if outlook_conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Outlook calendar conflict detected",
                    "conflicts": [],
                    "outlook_conflicts": outlook_conflicts,
                },
            )

    town_to_town, town_to_town_warning, town_to_town_drive_minutes = await _check_town_to_town(
        data.employee_id, date_to_schedule, data.location_id
    )
    doc = _build_schedule_doc(
        data,
        date_to_schedule,
        drive_time,
        town_to_town,
        town_to_town_warning,
        recurrence_rule,
        location,
        employee,
        class_doc,
        town_to_town_drive_minutes=town_to_town_drive_minutes,
    )
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)
    _enqueue_outlook_event(employee, location, class_doc, doc)
    logger.info(
        f"Schedule created: {doc['id']}",
        extra={
            "entity": {
                "schedule_id": doc["id"],
                "employee_id": data.employee_id,
                "location_id": data.location_id,
            }
        },
    )

    # Sync town-to-town for sibling schedules on the same day
    await _sync_same_day_town_to_town(
        data.employee_id, date_to_schedule
    )

    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created",
        description=f"{employee['name']} assigned to {location['city_name']}{class_label} — 1 class starting {data.date}",
        entity_type="schedule",
        entity_id=doc["id"],
        user_name=user.get("name", "System"),
    )
    return doc


async def _handle_bulk_background(
    data: ScheduleCreate,
    dates_to_schedule: list[str],
    drive_time: int,
    recurrence_rule: Optional[any],
    location: dict,
    employee: dict,
    class_doc: Optional[dict],
    user: SchedulerRequired,
):
    from core.queue import get_redis_pool

    pool = await get_redis_pool()
    if not pool:
        return None

    recurrence_dict = recurrence_rule.model_dump() if recurrence_rule else None

    await pool.enqueue_job(
        "generate_bulk_schedules",
        data_dict=data.model_dump(),
        dates_to_schedule=dates_to_schedule,
        drive_time=drive_time,
        recurrence_rule_dict=recurrence_dict,
        location=location,
        employee=employee,
        class_doc=class_doc,
        user_name=user.get("name", "System"),
    )
    logger.info(
        f"Bulk schedules enqueued for {employee['name']}",
        extra={
            "entity": {
                "employee_id": data.employee_id,
                "location_id": data.location_id,
                "dates_count": len(dates_to_schedule),
            }
        },
    )

    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created_bulk_enqueued",
        description=f"Bulk schedule pipeline queued for {employee['name']} at {location['city_name']}{class_label} ({len(dates_to_schedule)} dates)",
        entity_type="schedule_batch",
        entity_id=str(uuid.uuid4()),
        user_name=user.get("name", "System"),
    )
    return {
        "message": "Bulk schedule generation is running in the background.",
        "total_created": len(dates_to_schedule),
        "background": True,
    }


async def _handle_bulk_synchronous(
    data: ScheduleCreate,
    dates_to_schedule: list[str],
    drive_time: int,
    recurrence_rule: Optional[any],
    location: dict,
    employee: dict,
    class_doc: Optional[dict],
    user: SchedulerRequired,
):
    from services.schedule_utils import check_conflicts_bulk

    created = []
    conflicts_found = []

    # Bulk check conflicts for all dates
    all_conflicts = await check_conflicts_bulk(
        data.employee_id,
        dates_to_schedule,
        data.start_time,
        data.end_time,
        drive_time,
    )

    # Bulk check town-to-town travel warnings for all dates
    all_town_warnings = await _check_town_to_town_bulk(
        data.employee_id, dates_to_schedule, data.location_id
    )

    docs_to_insert = []

    for sched_date in dates_to_schedule:
        conflicts = all_conflicts.get(sched_date, [])
        if conflicts:
            conflicts_found.append(
                {"date": sched_date, "conflicts": conflicts}
            )
            continue

        town_to_town, town_to_town_warning, tt_drive_minutes = all_town_warnings.get(
            sched_date, (False, None, None)
        )

        doc = _build_schedule_doc(
            data,
            sched_date,
            drive_time,
            town_to_town,
            town_to_town_warning,
            recurrence_rule,
            location,
            employee,
            class_doc,
            town_to_town_drive_minutes=tt_drive_minutes,
        )
        docs_to_insert.append(doc)

    if docs_to_insert:
        await db.schedules.insert_many(docs_to_insert)
        for doc in docs_to_insert:
            doc.pop("_id", None)
            created.append(doc)

    if created:
        count_label = (
            f"{len(created)} classes" if len(created) > 1 else "class"
        )
        class_label = f" for {class_doc['name']}" if class_doc else ""
        await log_activity(
            action="schedule_created",
            description=f"{employee['name']} assigned to {location['city_name']}{class_label} — {count_label} starting {data.date}",
            entity_type="schedule",
            entity_id=created[0]["id"],
            user_name=user.get("name", "System"),
        )
    return {
        "created": created,
        "conflicts_skipped": conflicts_found,
        "total_created": len(created),
        "warning": "Redis unavailable, processed synchronously",
    }


@router.post(
    "",
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Location or Employee not found",
        },
        409: {
            "model": ErrorResponse,
            "description": "Schedule conflict detected",
        },
    },
)
async def create_schedule(data: ScheduleCreate, user: SchedulerRequired):
    location, employee, class_doc = await _fetch_schedule_entities(data)

    drive_time = (
        data.drive_to_override_minutes
        if data.drive_to_override_minutes
        else location["drive_time_minutes"]
    )
    recurrence_rule = build_recurrence_rule(data)
    dates_to_schedule = build_recurrence_dates(data.date, recurrence_rule)

    if len(dates_to_schedule) == 1:
        return await _handle_single_schedule(
            data,
            dates_to_schedule[0],
            drive_time,
            recurrence_rule,
            location,
            employee,
            class_doc,
            user,
        )

    result = await _handle_bulk_background(
        data,
        dates_to_schedule,
        drive_time,
        recurrence_rule,
        location,
        employee,
        class_doc,
        user,
    )
    if result:
        return result

    return await _handle_bulk_synchronous(
        data,
        dates_to_schedule,
        drive_time,
        recurrence_rule,
        location,
        employee,
        class_doc,
        user,
    )


async def _get_location_update(location_id: str, update_data: dict):
    location = await db.locations.find_one({"id": location_id}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    update_data["location_name"] = location["city_name"]
    if "travel_override_minutes" not in update_data:
        update_data["drive_time_minutes"] = location["drive_time_minutes"]


async def _get_employee_update(employee_id: str, update_data: dict):
    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    update_data["employee_name"] = employee["name"]
    update_data["employee_color"] = employee.get(
        "color", DEFAULT_EMPLOYEE_COLOR
    )


async def _get_class_update(class_id: str, update_data: dict):
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
    """Handle per-leg drive time overrides (drive_to and drive_from)."""
    # Resolve location for restoring defaults
    location_id = update_data.get("location_id")
    if not location_id:
        existing = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
        if existing:
            location_id = existing.get("location_id")

    loc = None
    if location_id:
        loc = await db.locations.find_one({"id": location_id}, {"_id": 0})

    # drive_to_override_minutes controls drive_time_minutes (hub→location)
    if "drive_to_override_minutes" in update_data:
        if update_data["drive_to_override_minutes"]:
            update_data["drive_time_minutes"] = update_data["drive_to_override_minutes"]
        elif loc:
            update_data["drive_time_minutes"] = loc["drive_time_minutes"]

    # drive_from_override_minutes is stored directly on the doc (used by chain builder)


@router.put(
    "/{schedule_id}",
    responses={
        400: {"model": ErrorResponse, "description": "No fields to update"},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    },
)
async def update_schedule(
    schedule_id: str, data: ScheduleUpdate, user: SchedulerRequired
):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    if "location_id" in update_data:
        await _get_location_update(update_data["location_id"], update_data)
    if "employee_id" in update_data:
        await _get_employee_update(update_data["employee_id"], update_data)
    if "class_id" in update_data:
        await _get_class_update(update_data["class_id"], update_data)
    if "drive_to_override_minutes" in update_data or "drive_from_override_minutes" in update_data:
        await _handle_drive_overrides(schedule_id, update_data)

    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    # Recalculate town-to-town for all schedules on this employee+date
    recalc_fields = {"location_id", "date", "employee_id"}
    if recalc_fields & update_data.keys():
        updated_sched = await db.schedules.find_one(
            {"id": schedule_id, "deleted_at": None}, {"_id": 0}
        )
        if updated_sched:
            await _sync_same_day_town_to_town(
                updated_sched["employee_id"],
                updated_sched["date"],
            )

    logger.info(
        f"Schedule updated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    return await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )


@router.delete(
    "/{schedule_id}",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def delete_schedule(schedule_id: str, user: SchedulerRequired):
    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule soft-deleted: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    if schedule:
        await _enqueue_outlook_delete(schedule)
        # Sync siblings — one fewer schedule means town-to-town may no longer apply
        await _sync_same_day_town_to_town(
            schedule["employee_id"],
            schedule["date"],
        )
        await log_activity(
            "schedule_deleted",
            f"Class at {schedule.get('location_name', '?')} on {schedule.get('date', '?')} removed",
            "schedule",
            schedule_id,
            user.get("name", "System"),
        )
    return {"message": "Schedule deleted"}


@router.post(
    "/{schedule_id}/restore",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def restore_schedule(schedule_id: str, user: SchedulerRequired):
    result = await db.schedules.update_one(
        {"id": schedule_id}, {"$set": {"deleted_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule restored: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    await log_activity(
        "schedule_restored",
        f"Schedule with ID '{schedule_id}' restored",
        "schedule",
        schedule_id,
        user.get("name", "System"),
    )
    return {"message": "Schedule restored"}


@router.put(
    "/{schedule_id}/status",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid status"},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    },
)
async def update_schedule_status(
    schedule_id: str, data: StatusUpdate, user: SchedulerRequired
):
    if data.status not in [
        STATUS_UPCOMING,
        STATUS_IN_PROGRESS,
        STATUS_COMPLETED,
    ]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": {"status": data.status}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule status updated: {schedule_id} to {data.status}",
        extra={"entity": {"schedule_id": schedule_id, "status": data.status}},
    )
    updated = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    await log_activity(
        action=f"status_{data.status}",
        description=f"Class at {updated.get('location_name', '?')} marked as {data.status.replace('_', ' ')}",
        entity_type="schedule",
        entity_id=schedule_id,
        user_name=user.get("name", "System"),
    )
    return updated


@router.put(
    "/{schedule_id}/relocate",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
        409: {"model": ErrorResponse, "description": "Conflict at new time"},
    },
)
async def relocate_schedule(
    schedule_id: str, data: ScheduleRelocate, user: SchedulerRequired
):
    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    drive_time = schedule.get("drive_time_minutes", 0)
    conflicts = await check_conflicts(
        schedule["employee_id"],
        data.date,
        data.start_time,
        data.end_time,
        drive_time,
        exclude_id=schedule_id,
    )
    if conflicts and not data.force:
        raise HTTPException(
            status_code=409,
            detail={"message": "Conflict at new time", "conflicts": conflicts},
        )

    # Recalculate town-to-town after relocating
    update_fields = {
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
    }

    await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": update_fields},
    )
    logger.info(
        f"Schedule relocated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id, "new_date": data.date}},
    )

    # Sync town-to-town + restore drive_time_minutes for all schedules on new date
    old_date = schedule.get("date")
    await _sync_same_day_town_to_town(
        schedule["employee_id"], data.date
    )
    # Also sync old date if it changed (remaining schedules may no longer be town-to-town)
    if old_date and old_date != data.date:
        await _sync_same_day_town_to_town(
            schedule["employee_id"], old_date
        )

    updated = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )

    await log_activity(
        "schedule_relocated",
        f"Class at {updated.get('location_name', '?')} moved to {data.date} {data.start_time}-{data.end_time}",
        "schedule",
        schedule_id,
        user.get("name", "System"),
    )
    return updated


@router.post(
    "/check-conflicts",
    responses={
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}
    },
)
async def check_schedule_conflicts(data: ScheduleCreate, user: CurrentUser):
    location = await db.locations.find_one(
        {"id": data.location_id}, {"_id": 0}
    )
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    drive_time = (
        data.drive_to_override_minutes
        if data.drive_to_override_minutes
        else location["drive_time_minutes"]
    )
    conflicts = await check_conflicts(
        data.employee_id, data.date, data.start_time, data.end_time, drive_time
    )
    outlook_conflicts = await check_outlook_conflicts(
        data.employee_id, data.date, data.start_time, data.end_time
    )

    # Build full day travel chain for the employee
    travel_chain = None
    town_to_town_info = None
    if data.employee_id and data.date and data.location_id:
        travel_chain = await _build_travel_chain(
            data.employee_id,
            data.date,
            data.location_id,
            data.start_time,
            data.end_time,
            schedule_id=getattr(data, "schedule_id", None),
            drive_to_override=data.drive_to_override_minutes,
            drive_from_override=data.drive_from_override_minutes,
        )
        # Keep town_to_town for backward compatibility
        tt, tt_warning, tt_drive_min = await _check_town_to_town(
            data.employee_id, data.date, data.location_id
        )
        if tt:
            same_day = await db.schedules.find(
                {
                    "employee_id": data.employee_id,
                    "date": data.date,
                    "location_id": {"$ne": data.location_id},
                    "deleted_at": None,
                },
                {"_id": 0, "location_name": 1},
            ).to_list(100)
            other_locations = list({s["location_name"] for s in same_day})
            town_to_town_info = {
                "detected": True,
                "drive_minutes": tt_drive_min,
                "other_locations": other_locations,
                "warning": tt_warning,
            }

    return {
        "has_conflicts": len(conflicts) > 0 or len(outlook_conflicts) > 0,
        "conflicts": conflicts,
        "outlook_conflicts": outlook_conflicts,
        "town_to_town": town_to_town_info,
        "travel_chain": travel_chain,
    }


@router.get("/export")
async def export_schedules(
    current_user: AdminRequired,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    employee_id: Optional[str] = None,
    location_id: Optional[str] = None,
    fields: Optional[
        str
    ] = "date,start_time,end_time,employee_name,employee_email,location_name,class_name,status,notes",
):
    query = {"deleted_at": None}

    if start_date and end_date:
        query["date"] = {"$gte": start_date, "$lte": end_date}
    elif start_date:
        query["date"] = {"$gte": start_date}
    elif end_date:
        query["date"] = {"$lte": end_date}

    if employee_id:
        query["employee_id"] = employee_id
    if location_id:
        query["location_id"] = location_id

    cursor = db.schedules.find(query).sort("date", 1)
    schedules = await cursor.to_list(length=None)

    # Fetch related data
    emp_ids = list({s["employee_id"] for s in schedules if "employee_id" in s})
    loc_ids = list({s["location_id"] for s in schedules if "location_id" in s})
    class_ids = list({s["class_id"] for s in schedules if s.get("class_id")})

    employees = await db.employees.find({"id": {"$in": emp_ids}}, {"_id": 0}).to_list(
        length=None
    )
    locations = await db.locations.find({"id": {"$in": loc_ids}}, {"_id": 0}).to_list(
        length=None
    )
    classes = await db.classes.find({"id": {"$in": class_ids}}, {"_id": 0}).to_list(
        length=None
    )

    emp_map = {e["id"]: e for e in employees}
    loc_map = {l["id"]: l for l in locations}
    class_map = {c["id"]: c for c in classes}

    field_list = [f.strip() for f in fields.split(",") if f.strip()]
    if not field_list:
        field_list = [
            "date",
            "start_time",
            "end_time",
            "employee_name",
            "location_name",
        ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(field_list)

    for s in schedules:
        emp = emp_map.get(s.get("employee_id"), {})
        loc = loc_map.get(s.get("location_id"), {})
        cls = class_map.get(s.get("class_id"), {})

        row_data = {
            "date": s.get("date", ""),
            "start_time": s.get("start_time", ""),
            "end_time": s.get("end_time", ""),
            "employee_name": emp.get("name", "Unknown"),
            "employee_email": emp.get("email", ""),
            "location_name": loc.get("city_name", "Unknown"),
            "class_name": cls.get("name", ""),
            "status": s.get("status", ""),
            "notes": s.get("notes", ""),
        }

        row = [row_data.get(f, "") for f in field_list]
        writer.writerow(row)

    output.seek(0)

    filename = f"schedules_export_{datetime.now().strftime('%Y%m%d')}.csv"
    headers = {"Content-Disposition": f"attachment; filename={filename}"}

    return StreamingResponse(
        iter([output.getvalue()]), media_type="text/csv", headers=headers
    )


@router.post(
    "/import/preview",
    responses={400: {"model": ErrorResponse, "description": "Invalid CSV file or missing required columns"}},
)
async def import_schedules_preview(
    current_user: AdminRequired, file: Annotated[UploadFile, File()]
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=400, detail="Only CSV files are supported"
        )

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    # Required columns (allow some flexibility)
    required_cols = {
        "date",
        "start_time",
        "end_time",
        "employee_email",
        "location_name",
    }

    if not reader.fieldnames:
        raise HTTPException(
            status_code=400, detail="Empty CSV file or missing headers"
        )

    actual_cols = {c.lower().strip() for c in reader.fieldnames if c}
    missing = required_cols - actual_cols
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Missing required columns. File must have headers: date, start_time, end_time, employee_email, location_name",
        )

    # Pre-fetch employees, locations, classes to do lookups
    all_employees = await db.employees.find({"deleted_at": None}).to_list(
        length=None
    )
    all_locations = await db.locations.find({"deleted_at": None}).to_list(
        length=None
    )
    all_classes = await db.classes.find({"deleted_at": None}).to_list(
        length=None
    )

    emp_by_email = {
        e.get("email", "").lower(): e for e in all_employees if e.get("email")
    }
    loc_by_name = {
        loc.get("city_name", "").lower(): loc
        for loc in all_locations
        if loc.get("city_name")
    }
    class_by_name = {
        c.get("name", "").lower(): c for c in all_classes if c.get("name")
    }

    valid_rows = []
    errors = []

    date_regex = python_re.compile(r"^\d{4}-\d{2}-\d{2}$")
    time_regex = python_re.compile(r"^\d{2}:\d{2}$")

    for row_idx, row in enumerate(reader, start=2):
        row_clean = {
            k.lower().strip(): v.strip()
            for k, v in row.items()
            if k and v is not None
        }
        if not row_clean:
            continue

        result = _validate_import_row(
            row_clean,
            date_regex,
            time_regex,
            emp_by_email,
            loc_by_name,
            class_by_name,
        )

        if "errors" in result:
            errors.append(
                {"row": row_idx, "errors": result["errors"], "data": row_clean}
            )
        else:
            valid_data = result["valid_data"]
            valid_data["row_idx"] = row_idx
            valid_rows.append(valid_data)

    return {
        "valid_rows": valid_rows,
        "errors": errors,
        "total_rows": len(valid_rows) + len(errors),
    }


@router.post("/import")
async def import_schedules_commit(
    current_user: AdminRequired, items: list[ScheduleImportItem]
):
    if not items:
        return {"inserted_count": 0, "errors": []}

    inserted_count = 0
    errors = []

    # Simple check for each item before inserting
    for item in items:
        # Re-verify conflicts? For simplicity, we can do it row by row
        try:
            # We don't have to check if location/employee exists because we just verified it in preview,
            # but we should check conflicts

            # This logic mimics the standard create schedule conflict check
            employee = await db.employees.find_one(
                {"id": item.employee_id, "deleted_at": None}
            )
            location = await db.locations.find_one(
                {"id": item.location_id, "deleted_at": None}
            )

            if not employee or not location:
                errors.append(
                    {
                        "row": item.row_idx,
                        "error": "Employee or Location no longer exists",
                    }
                )
                continue

            drive_minutes = location.get("drive_time_minutes", 0)
            conflict = await check_conflicts(
                item.employee_id,
                item.date,
                item.start_time,
                item.end_time,
                drive_minutes,
            )

            if conflict:
                errors.append(
                    {
                        "row": item.row_idx,
                        "error": f"Conflict with existing schedule for {employee.get('name')} on {item.date} at {item.start_time}",
                    }
                )
                continue

            # Look up class if provided
            class_obj = None
            if item.class_id:
                class_obj = await db.classes.find_one({"id": item.class_id, "deleted_at": None})

            new_schedule = {
                "id": str(uuid.uuid4()),
                "employee_id": item.employee_id,
                "employee_name": employee.get("name", ""),
                "employee_color": employee.get("color", ""),
                "location_id": item.location_id,
                "location_name": location.get("city_name", ""),
                "drive_time_minutes": drive_minutes,
                "class_id": item.class_id,
                "class_name": class_obj.get("name", "") if class_obj else "",
                "class_color": class_obj.get("color", "") if class_obj else "",
                "date": item.date,
                "start_time": item.start_time,
                "end_time": item.end_time,
                "notes": item.notes,
                "travel_override_minutes": None,
                "drive_to_override_minutes": None,
                "drive_from_override_minutes": None,
                "town_to_town": False,
                "town_to_town_warning": None,
                "town_to_town_drive_minutes": None,
                "status": STATUS_UPCOMING,
                "recurrence": "none",
                "recurrence_end_date": None,
                "recurrence_end_mode": None,
                "recurrence_occurrences": None,
                "custom_recurrence": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "deleted_at": None,
            }

            await db.schedules.insert_one(new_schedule)
            inserted_count += 1

        except Exception:
            logger.exception(
                "Error importing schedule row %s",
                getattr(item, "row_idx", None),
            )
            errors.append(
                {
                    "row": item.row_idx,
                    "error": "An internal error occurred while importing this row.",
                }
            )

    # Log activity
    if inserted_count > 0:
        await log_activity(
            action="import_schedules",
            description=f"Imported {inserted_count} schedules via CSV",
            entity_type="schedule",
            entity_id="bulk_import",
            user_name=current_user["name"],
        )

    return {"inserted_count": inserted_count, "errors": errors}
