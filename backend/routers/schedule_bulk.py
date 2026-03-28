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
from core.constants import (
    STATUS_UPCOMING,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    DEFAULT_EMPLOYEE_COLOR,
)
from routers.schedule_helpers import (
    logger,
    EMPLOYEE_NOT_FOUND,
    LOCATION_NOT_FOUND,
    CLASS_NOT_FOUND,
)

router = APIRouter(tags=["schedules"])


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
