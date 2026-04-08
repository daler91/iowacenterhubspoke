"""Schedule CRUD operations: list, get, create, update, delete, restore, status, relocate."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from database import db
from models.schemas import (
    ScheduleCreate,
    ScheduleUpdate,
    StatusUpdate,
    ScheduleRelocate,
    ErrorResponse,
)
from core.auth import CurrentUser, SchedulerRequired
from services.activity import log_activity
from services.schedule_utils import check_conflicts
from core.constants import (
    STATUS_UPCOMING,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    SCHEDULE_STATUS_TO_PROJECT_PHASE,
    PROJECT_PHASE_ORDER,
)
from routers.schedule_helpers import (
    logger,
    SCHEDULE_NOT_FOUND,
    LOCATION_NOT_FOUND,
    CLASS_NOT_FOUND,
    NO_FIELDS_TO_UPDATE,
    _sync_same_day_town_to_town,
    _delete_calendar_events_for_all,
    _enqueue_calendar_events_for_all,
    _fetch_employees,
    _build_employees_snapshot,
)
from routers.schedule_create import create_schedule as _create_schedule

router = APIRouter(tags=["schedules"])


# --- List / Get ---

@router.get("/", summary="List schedules")
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
        query["employee_ids"] = employee_id

    total = await db.schedules.count_documents(query)
    schedules = (
        await db.schedules.find(query, {"_id": 0})
        .sort([("date", 1), ("start_time", 1)])
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    return {"items": schedules, "total": total, "skip": skip, "limit": limit}


@router.get(
    "/{schedule_id}",
    summary="Get a single schedule",
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


# --- Create ---

@router.post(
    "/",
    summary="Create a schedule (single or recurring)",
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
    return await _create_schedule(data, user)


# --- Update ---

async def _get_location_update(location_id: str, update_data: dict):
    location = await db.locations.find_one({"id": location_id}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    update_data["location_name"] = location["city_name"]
    if "travel_override_minutes" not in update_data:
        update_data["drive_time_minutes"] = location["drive_time_minutes"]


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


async def _resolve_update_relations(schedule_id: str, update_data: dict):
    """Resolve location, employee, class, and drive override relations for an update."""
    if "location_id" in update_data:
        await _get_location_update(update_data["location_id"], update_data)
    if "employee_ids" in update_data:
        employees = await _fetch_employees(update_data["employee_ids"])
        update_data["employees"] = _build_employees_snapshot(employees)
        update_data.pop("employee_id", None)
        update_data.pop("employee_name", None)
        update_data.pop("employee_color", None)
    if "class_id" in update_data:
        await _get_class_update(update_data["class_id"], update_data)
    if "drive_to_override_minutes" in update_data or "drive_from_override_minutes" in update_data:
        await _handle_drive_overrides(schedule_id, update_data)


async def _sync_town_to_town_if_needed(schedule_id: str, update_data: dict):
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


async def _sync_calendar_events_if_needed(
    schedule_id: str, update_data: dict, old_schedule: dict
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


@router.put(
    "/{schedule_id}",
    summary="Update a schedule",
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

    old_schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )

    await _resolve_update_relations(schedule_id, update_data)

    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    await _sync_town_to_town_if_needed(schedule_id, update_data)
    await _sync_calendar_events_if_needed(schedule_id, update_data, old_schedule)

    logger.info(
        f"Schedule updated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    return await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )


# --- Delete / Restore ---

@router.delete(
    "/{schedule_id}",
    summary="Soft-delete a schedule",
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
        await _delete_calendar_events_for_all(schedule)
        for emp_id in schedule.get("employee_ids", []):
            await _sync_same_day_town_to_town(
                emp_id,
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
    summary="Restore a deleted schedule",
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


# --- Status / Relocate ---

@router.put(
    "/{schedule_id}/status",
    summary="Update schedule status",
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
    # Auto-advance linked project phase when schedule status changes
    target_phase = SCHEDULE_STATUS_TO_PROJECT_PHASE.get(data.status)
    if target_phase:
        linked_project = await db.projects.find_one(
            {"schedule_id": schedule_id, "deleted_at": None},
            {"_id": 0, "id": 1, "phase": 1},
        )
        if linked_project:
            current_idx = PROJECT_PHASE_ORDER.get(linked_project["phase"], 0)
            target_idx = PROJECT_PHASE_ORDER.get(target_phase, 0)
            if target_idx > current_idx:
                now = datetime.now(timezone.utc).isoformat()
                await db.projects.update_one(
                    {"id": linked_project["id"]},
                    {"$set": {"phase": target_phase, "updated_at": now}},
                )
                await log_activity(
                    "project_phase_auto_advanced",
                    f"Project auto-advanced to {target_phase} (schedule {data.status})",
                    "project",
                    linked_project["id"],
                    user.get("name", "System"),
                )
    return updated


async def _check_relocate_conflicts(schedule: dict, data, schedule_id: str):
    """Check conflicts for the first employee when relocating."""
    drive_time = schedule.get("drive_time_minutes", 0)
    employee_ids = schedule.get("employee_ids", [])
    first_employee_id = employee_ids[0] if employee_ids else None
    if not first_employee_id:
        return
    conflicts = await check_conflicts(
        first_employee_id, data.date, data.start_time, data.end_time,
        drive_time, exclude_id=schedule_id,
    )
    if conflicts and not data.force:
        raise HTTPException(
            status_code=409,
            detail={"message": "Conflict at new time", "conflicts": conflicts},
        )


async def _sync_relocate_calendar(old_schedule: dict, updated: dict):
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


@router.put(
    "/{schedule_id}/relocate",
    summary="Relocate a schedule to a new date/time",
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

    await _check_relocate_conflicts(schedule, data, schedule_id)

    await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": {"date": data.date, "start_time": data.start_time, "end_time": data.end_time}},
    )
    logger.info(
        f"Schedule relocated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id, "new_date": data.date}},
    )

    old_date = schedule.get("date")
    for emp_id in schedule.get("employee_ids", []):
        await _sync_same_day_town_to_town(emp_id, data.date)
        if old_date and old_date != data.date:
            await _sync_same_day_town_to_town(emp_id, old_date)

    updated = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )

    await _sync_relocate_calendar(schedule, updated)

    await log_activity(
        "schedule_relocated",
        f"Class at {updated.get('location_name', '?')} moved to {data.date} {data.start_time}-{data.end_time}",
        "schedule",
        schedule_id,
        user.get("name", "System"),
    )
    return updated
