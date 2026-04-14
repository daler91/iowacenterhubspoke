"""Bulk schedule operations: bulk delete, status, reassign, location, class."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from database import db
from models.schemas import (
    BulkDeleteRequest,
    BulkStatusUpdateRequest,
    BulkReassignRequest,
    BulkLocationUpdateRequest,
    BulkClassUpdateRequest,
    ErrorResponse,
)
from core.auth import SchedulerRequired
from services.activity import log_activity
from services.notification_events import (
    notify_schedule_assigned,
    notify_schedule_bulk_location_changed,
    notify_schedule_bulk_status_changed,
    notify_schedule_changed,
)
from core.constants import (
    STATUS_UPCOMING,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
)
from services.schedule_utils import check_conflicts
from routers.schedule_helpers import (
    logger,
    _build_employees_snapshot,
    _sync_same_day_town_to_town,
    EMPLOYEE_NOT_FOUND,
    LOCATION_NOT_FOUND,
    CLASS_NOT_FOUND,
)

router = APIRouter(tags=["schedules"])


@router.post("/bulk-delete", summary="Bulk delete schedules")
async def bulk_delete_schedules(
    data: BulkDeleteRequest, user: SchedulerRequired
):
    # Snapshot schedules before delete so we can notify each one's employees.
    affected = await db.schedules.find(
        {"id": {"$in": data.ids}, "deleted_at": None}, {"_id": 0},
    ).to_list(1000)
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
        for s in affected:
            await notify_schedule_changed(s, "cancelled", user)
    return {"deleted_count": deleted_count}


@router.put(
    "/bulk-status",
    summary="Bulk update schedule status",
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
    # Snapshot affected schedules before the update so we can notify each
    # schedule's employees. Only includes not-already-in-this-status rows.
    affected = await db.schedules.find(
        {"id": {"$in": data.ids}, "deleted_at": None, "status": {"$ne": data.status}},
        {"_id": 0},
    ).to_list(1000)
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
        for s in affected:
            await notify_schedule_bulk_status_changed(s, data.status, user)
    return {"updated_count": updated_count}


async def _check_reassign_conflicts(schedules, employees):
    """Pre-flight conflict check for bulk reassignment."""
    conflicts = []
    for sched in schedules:
        for emp in employees:
            if emp["id"] in sched.get("employee_ids", []):
                continue
            found = await check_conflicts(
                emp["id"], sched["date"], sched["start_time"], sched["end_time"],
                sched.get("drive_time_minutes", 0), exclude_id=sched["id"],
            )
            if found:
                conflicts.append({
                    "schedule_id": sched["id"],
                    "date": sched["date"],
                    "employee_name": emp["name"],
                    "conflicts": found,
                })
    return conflicts


@router.put(
    "/bulk-reassign",
    summary="Bulk reassign schedules to another employee",
    responses={
        404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}
    },
)
async def bulk_reassign_schedules(
    data: BulkReassignRequest, user: SchedulerRequired
):
    employees_cursor = db.employees.find(
        {"id": {"$in": data.employee_ids}, "deleted_at": None}, {"_id": 0}
    )
    employees = await employees_cursor.to_list(length=len(data.employee_ids))
    if len(employees) != len(data.employee_ids):
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    employees_snapshot = _build_employees_snapshot(employees)
    employee_ids = [e["id"] for e in employees]
    names = ", ".join(e["name"] for e in employees)

    # Pre-flight conflict check for new employees
    schedules = await db.schedules.find(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {"_id": 0, "id": 1, "date": 1, "start_time": 1, "end_time": 1,
         "drive_time_minutes": 1, "employee_ids": 1},
    ).to_list(200)

    conflict_preview = await _check_reassign_conflicts(schedules, employees)

    if conflict_preview and not data.force:
        return {
            "preview": True,
            "conflicts": conflict_preview,
            "message": f"{len(conflict_preview)} conflict(s) found. Set force=true to proceed.",
        }

    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {
            "$set": {
                "employee_ids": employee_ids,
                "employees": employees_snapshot,
            }
        },
    )
    updated_count = result.modified_count

    # Recalculate town-to-town for affected employees/dates
    affected_dates = {s["date"] for s in schedules}
    for emp_id in employee_ids:
        for d in affected_dates:
            await _sync_same_day_town_to_town(emp_id, d)

    if updated_count > 0:
        logger.info(
            f"Bulk reassigned {updated_count} schedules to {names}",
            extra={
                "entity": {
                    "updated_count": updated_count,
                    "employee_ids": employee_ids,
                }
            },
        )
        await log_activity(
            action="schedule_bulk_reassigned",
            description=f"Bulk reassigned {updated_count} schedule(s) to {names}",
            entity_type="schedule_batch",
            entity_id=str(uuid.uuid4()),
            user_name=user.get("name", "System"),
        )
        # Notify each updated schedule's new assignees.
        for s in schedules:
            await notify_schedule_assigned({**s, "employee_ids": employee_ids},
                                           employee_ids, user)
    return {"updated_count": updated_count}


@router.put(
    "/bulk-location",
    summary="Bulk update schedule location",
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

    new_drive_time = location["drive_time_minutes"]

    # Pre-flight conflict check with new drive time. We also pull
    # ``location_id`` / ``location_name`` so the notification step can
    # skip schedules whose location didn't actually change.
    schedules = await db.schedules.find(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {"_id": 0, "id": 1, "date": 1, "start_time": 1, "end_time": 1,
         "employee_ids": 1, "location_id": 1, "location_name": 1},
    ).to_list(200)

    conflict_preview = []
    for sched in schedules:
        for emp_id in sched.get("employee_ids", [])[:1]:  # check primary employee
            conflicts = await check_conflicts(
                emp_id, sched["date"], sched["start_time"], sched["end_time"],
                new_drive_time, exclude_id=sched["id"],
            )
            if conflicts:
                conflict_preview.append({
                    "schedule_id": sched["id"],
                    "date": sched["date"],
                    "conflicts": conflicts,
                })

    if conflict_preview and not data.force:
        return {
            "preview": True,
            "conflicts": conflict_preview,
            "message": f"{len(conflict_preview)} conflict(s) found. Set force=true to proceed.",
        }

    result = await db.schedules.update_many(
        {"id": {"$in": data.ids}, "deleted_at": None},
        {
            "$set": {
                "location_id": data.location_id,
                "location_name": location["city_name"],
                "drive_time_minutes": new_drive_time,
            },
            # Strip the legacy override so bulk-relocated schedules reset to
            # the new location's default drive time (matches old behaviour).
            "$unset": {"travel_override_minutes": ""},
        },
    )
    updated_count = result.modified_count

    # Recalculate town-to-town for affected employees/dates
    for sched in schedules:
        for emp_id in sched.get("employee_ids", []):
            await _sync_same_day_town_to_town(emp_id, sched["date"])

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
        # Only notify schedules whose location actually changed. If a caller
        # passed a mixed batch (some already at the target location), those
        # unchanged rows shouldn't emit a bogus "moved" notification.
        for s in schedules:
            if s.get("location_id") == data.location_id:
                continue
            await notify_schedule_bulk_location_changed(
                s, location["city_name"], user,
            )
    return {"updated_count": updated_count}


@router.put(
    "/bulk-class",
    summary="Bulk update schedule class type",
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
