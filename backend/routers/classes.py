import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Optional
from database import db
from models.schemas import ClassCreate, ClassUpdate, ErrorResponse
from core.auth import CurrentUser, AdminRequired
from core.pagination import Paginated
from core.repository import SoftDeleteRepository
from services.activity import log_activity
from services.workload_cache import invalidate as invalidate_workload_cache
from core.logger import get_logger
from core.constants import DEFAULT_CLASS_COLOR
from core.queue import get_redis_pool

logger = get_logger(__name__)

router = APIRouter(prefix="/classes", tags=["classes"])

CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

classes_repo = SoftDeleteRepository(db, "classes")


def get_class_snapshot(class_doc: Optional[dict]) -> dict:
    if not class_doc:
        return {
            "class_id": None,
            "class_name": None,
            "class_color": None,
            "class_description": None,
        }
    return {
        "class_id": class_doc["id"],
        "class_name": class_doc["name"],
        "class_color": class_doc.get("color", DEFAULT_CLASS_COLOR),
        "class_description": class_doc.get("description"),
    }


async def sync_class_snapshot_background(class_id: str):
    pool = await get_redis_pool()
    if pool:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="class", entity_id=class_id)
    else:
        # Fallback: sync inline when Redis/worker isn't available
        class_doc = await db.classes.find_one({"id": class_id}, {"_id": 0})
        if class_doc:
            snapshot = get_class_snapshot(class_doc)
            await db.schedules.update_many(
                {"class_id": class_id},
                {"$set": {
                    "class_name": snapshot["class_name"],
                    "class_color": snapshot["class_color"],
                    "class_description": snapshot["class_description"],
                }},
            )
            logger.info("Inline sync completed for class", extra={"entity": {"class_id": class_id}})


@router.get("", summary="List all class types")
async def get_classes(user: CurrentUser, pagination: Paginated):
    """Return paginated list of active class types, sorted by name."""
    return await classes_repo.paginated_response(
        {}, pagination, sort=[("name", 1)],
    )


@router.get(
    "/{class_id}",
    summary="Get a single class type",
    responses={404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND}},
)
async def get_class(class_id: str, user: CurrentUser):
    class_doc = await classes_repo.get_by_id(class_id)
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)
    return class_doc


@router.post("", summary="Create a new class type")
async def create_class(data: ClassCreate, user: AdminRequired):
    """Add a new class type with name, description, and calendar color."""
    class_id = str(uuid.uuid4())
    doc = {
        "id": class_id,
        "name": data.name,
        "description": data.description,
        "color": data.color,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None
    }
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    logger.info("Class created", extra={"entity": {"class_id": class_id}})
    await log_activity(
        "class_created", f"Class type '{data.name}' added",
        "class", class_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return doc


@router.put(
    "/{class_id}",
    summary="Update a class type",
    responses={
        400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE},
        404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND},
    },
)
async def update_class(class_id: str, data: ClassUpdate, user: AdminRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    result = await db.classes.update_one({"id": class_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    updated = await db.classes.find_one({"id": class_id}, {"_id": 0})
    await sync_class_snapshot_background(class_id)
    logger.info("Class updated", extra={"entity": {"class_id": class_id}})
    await log_activity(
        "class_updated", f"Class type '{updated['name']}' updated",
        "class", class_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return updated


@router.delete(
    "/{class_id}",
    summary="Soft-delete a class type",
    responses={404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND}},
)
async def delete_class(class_id: str, user: AdminRequired):
    """Soft-delete a class type. Existing schedules retain the class name/color as archived data."""
    class_doc = await classes_repo.get_by_id(class_id)
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    await db.schedules.update_many(
        {"class_id": class_id},
        {"$set": {
            "class_id": None,
            "class_name": class_doc["name"],
            "class_color": class_doc.get("color", "#0F766E"),
            "class_description": class_doc.get("description"),
        }}
    )
    await classes_repo.soft_delete(class_id, deleted_by=user.get("name"))
    logger.info("Class soft-deleted", extra={"entity": {"class_id": class_id}})
    await log_activity(
        "class_deleted", f"Class type '{class_doc['name']}' marked as deleted",
        "class", class_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return {"message": "Class deleted"}


@router.get(
    "/{class_id}/stats",
    summary="Get class type statistics",
    responses={404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND}},
)
async def get_class_stats(
    class_id: str, user: CurrentUser,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
):
    """Return schedule counts, employee/location breakdowns, and recent schedules for a class type."""
    class_doc = await classes_repo.get_by_id(class_id)
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    date_match = {}
    if start_date:
        date_match["$gte"] = start_date
    if end_date:
        date_match["$lte"] = end_date

    match_stage = {"class_id": class_id, "deleted_at": None}
    if date_match:
        match_stage["date"] = date_match

    time_expr = {
        "$cond": [
            {
                "$and": [
                    {"$regexMatch": {"input": {"$ifNull": ["$start_time", ""]}, "regex": r"^\d{2}:\d{2}$"}},
                    {"$regexMatch": {"input": {"$ifNull": ["$end_time", ""]}, "regex": r"^\d{2}:\d{2}$"}},
                ],
            },
            {
                "$subtract": [
                    {
                        "$add": [
                            {"$multiply": [{"$toInt": {"$arrayElemAt": [{"$split": ["$end_time", ":"]}, 0]}}, 60]},
                            {"$toInt": {"$arrayElemAt": [{"$split": ["$end_time", ":"]}, 1]}},
                        ],
                    },
                    {
                        "$add": [
                            {"$multiply": [{"$toInt": {"$arrayElemAt": [{"$split": ["$start_time", ":"]}, 0]}}, 60]},
                            {"$toInt": {"$arrayElemAt": [{"$split": ["$start_time", ":"]}, 1]}},
                        ],
                    },
                ],
            },
            0,
        ],
    }

    summary_pipeline = [
        {"$match": match_stage},
        {"$group": {
            "_id": None,
            "total_schedules": {"$sum": 1},
            "total_drive_minutes": {"$sum": {"$multiply": [{"$ifNull": ["$drive_time_minutes", 0]}, 2]}},
            "total_class_minutes": {"$sum": time_expr},
            "completed": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
            "upcoming": {"$sum": {"$cond": [{"$eq": ["$status", "upcoming"]}, 1, 0]}},
            "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}},
        }},
    ]
    summary = await db.schedules.aggregate(summary_pipeline).to_list(1)
    totals = summary[0] if summary else {
        "total_schedules": 0, "total_drive_minutes": 0, "total_class_minutes": 0,
        "completed": 0, "upcoming": 0, "in_progress": 0,
    }

    employee_breakdown = await db.schedules.aggregate([
        {"$match": match_stage},
        {"$group": {"_id": {"$ifNull": ["$employee_name", "Unknown"]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]).to_list(500)

    location_breakdown = await db.schedules.aggregate([
        {"$match": match_stage},
        {"$group": {"_id": {"$ifNull": ["$location_name", "Unknown"]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]).to_list(500)

    recent_schedules = await db.schedules.find(
        match_stage, {"_id": 0},
    ).sort("date", -1).limit(10).to_list(10)

    # Business outcomes from linked projects
    projects = await db.projects.find(
        {"class_id": class_id, "deleted_at": None},
        {"_id": 0, "phase": 1, "attendance_count": 1, "warm_leads": 1},
    ).to_list(500)
    projects_delivered = sum(1 for p in projects if p.get("phase") == "complete")
    total_attendance = sum(p.get("attendance_count") or 0 for p in projects)
    total_warm_leads = sum(p.get("warm_leads") or 0 for p in projects)

    return {
        "class_info": class_doc,
        "total_schedules": totals["total_schedules"],
        "total_drive_minutes": totals["total_drive_minutes"],
        "total_class_minutes": totals["total_class_minutes"],
        "completed": totals["completed"],
        "upcoming": totals["upcoming"],
        "in_progress": totals["in_progress"],
        "projects_delivered": projects_delivered,
        "total_attendance": total_attendance,
        "total_warm_leads": total_warm_leads,
        "employee_breakdown": employee_breakdown,
        "location_breakdown": location_breakdown,
        "recent_schedules": recent_schedules,
    }


@router.post(
    "/{class_id}/restore",
    summary="Restore a deleted class type",
    responses={404: {"model": ErrorResponse, "description": CLASS_NOT_FOUND}},
)
async def restore_class(class_id: str, user: AdminRequired):
    if not await classes_repo.restore(class_id):
        existing = await db.classes.find_one({"id": class_id}, {"_id": 1})
        if not existing:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)
    logger.info("Class restored", extra={"entity": {"class_id": class_id}})
    await log_activity(
        "class_restored", f"Class with ID '{class_id}' restored",
        "class", class_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return {"message": "Class restored"}
