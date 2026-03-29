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
    DEFAULT_EMPLOYEE_COLOR,
)
from routers.schedule_helpers import (
    logger,
    SCHEDULE_NOT_FOUND,
    LOCATION_NOT_FOUND,
    EMPLOYEE_NOT_FOUND,
    CLASS_NOT_FOUND,
    NO_FIELDS_TO_UPDATE,
    _sync_same_day_town_to_town,
    _enqueue_outlook_delete,
    _enqueue_google_delete,
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
        await _enqueue_outlook_delete(schedule)
        await _enqueue_google_delete(schedule)
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
    return updated


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

    old_date = schedule.get("date")
    await _sync_same_day_town_to_town(
        schedule["employee_id"], data.date
    )
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
