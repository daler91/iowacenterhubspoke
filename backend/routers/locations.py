import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import LocationCreate, LocationUpdate, ErrorResponse
from core.auth import CurrentUser, AdminRequired
from core.pagination import Paginated
from core.repository import SoftDeleteRepository
from services.activity import log_activity
from services.drive_time import get_drive_time_between_locations, get_drive_time_from_hub
from services.workload_cache import invalidate as invalidate_workload_cache
from core.logger import get_logger
from core.queue import get_redis_pool

logger = get_logger(__name__)

router = APIRouter(prefix="/locations", tags=["locations"])

LOCATION_NOT_FOUND = "Location not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

# Reference migration for the SoftDeleteRepository pattern — see
# ``backend/core/repository.py`` module docstring for the upgrade guide.
locations_repo = SoftDeleteRepository(db, "locations")


@router.get("", summary="List all locations")
async def get_locations(user: CurrentUser, pagination: Paginated):
    """Return paginated list of active (non-deleted) locations."""
    return await locations_repo.paginated_response({}, pagination)


@router.get(
    "/drive-time",
    responses={400: {"model": ErrorResponse, "description": "Both locations must have latitude and longitude set"}},
)
async def get_drive_time_between_endpoint(from_id: str, to_id: str, user: CurrentUser):
    """Get drive time between two locations using Google Distance Matrix (with caching)."""
    minutes = await get_drive_time_between_locations(from_id, to_id)
    if minutes is None:
        raise HTTPException(status_code=400, detail="Both locations must have latitude and longitude set")
    return {"from_id": from_id, "to_id": to_id, "drive_time_minutes": minutes}


@router.get("/drive-time-from-hub")
async def get_drive_time_from_hub_endpoint(lat: float, lng: float, user: CurrentUser):
    """Get drive time from Hub (Des Moines) to given coordinates."""
    minutes = await get_drive_time_from_hub(lat, lng)
    return {"drive_time_minutes": minutes}


@router.get(
    "/{location_id}",
    summary="Get a single location",
    responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}},
)
async def get_location(location_id: str, user: CurrentUser):
    location = await locations_repo.get_by_id(location_id)
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    return location


@router.post("", summary="Create a new location")
async def create_location(data: LocationCreate, user: AdminRequired):
    """Add a new satellite location. Requires admin role."""
    loc_id = str(uuid.uuid4())
    doc = {
        "id": loc_id,
        "city_name": data.city_name,
        "drive_time_minutes": data.drive_time_minutes,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None
    }
    await db.locations.insert_one(doc)
    doc.pop("_id", None)
    logger.info(
        "Location created",
        extra={"entity": {"location_id": loc_id}},
    )
    await log_activity(
        "location_created",
        f"Location '{data.city_name}' added ({data.drive_time_minutes}m from Hub)",
        "location", loc_id, user.get('name', 'System'),
    )
    return doc


@router.put(
    "/{location_id}",
    summary="Update a location",
    responses={
        400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE},
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND},
    },
)
async def update_location(location_id: str, data: LocationUpdate, user: AdminRequired):
    """Update location fields. Triggers background sync of denormalized schedule data."""
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.locations.update_one({"id": location_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info("Location updated", extra={"entity": {"location_id": location_id}})
    updated = await db.locations.find_one({"id": location_id}, {"_id": 0})

    # Trigger background sync for denormalized fields
    pool = await get_redis_pool()
    if pool:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="location", entity_id=location_id)
    else:
        # Fallback: sync inline when Redis/worker isn't available
        # Only update future schedules to preserve historical accuracy
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.schedules.update_many(
            {"location_id": location_id, "date": {"$gte": today_str}},
            {"$set": {
                "location_name": updated["city_name"],
                "drive_time_minutes": updated["drive_time_minutes"],
            }},
        )
        logger.info(
            "Inline sync completed for location (future only)",
            extra={"entity": {"location_id": location_id}},
        )

    # Location edits change location_name / drive_time_minutes on schedule
    # rows (either via the background job or the inline fallback above),
    # both of which feed /workload totals. Drop the cache so the next
    # read recomputes. The worker task also calls delete on completion,
    # which covers the window between this flush and the sync finishing.
    await invalidate_workload_cache()
    return updated


@router.delete(
    "/{location_id}",
    summary="Soft-delete a location",
    responses={
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND},
        409: {"model": ErrorResponse, "description": "Location has future schedules"},
    },
)
async def delete_location(location_id: str, user: AdminRequired):
    from datetime import date as date_type
    today = date_type.today().isoformat()
    future_count = await db.schedules.count_documents({
        "location_id": location_id, "date": {"$gte": today}, "deleted_at": None
    })
    if future_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {future_count} future schedule(s) at this location. Reassign or delete them first."
        )
    if not await locations_repo.soft_delete(location_id, deleted_by=user.get("name")):
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(
        "Location soft-deleted",
        extra={"entity": {"location_id": location_id}},
    )
    await log_activity(
        "location_deleted", f"Location '{location_id}' marked as deleted",
        "location", location_id, user.get('name', 'System'),
    )
    return {"message": "Location deleted"}


@router.get(
    "/{location_id}/stats",
    summary="Get location statistics",
    responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}},
)
async def get_location_stats(
    location_id: str, user: CurrentUser,
    start_date: Optional[str] = None, end_date: Optional[str] = None,
):
    """Return schedule counts, drive/class hours, and breakdowns for a location."""
    location = await locations_repo.get_by_id(location_id)
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    date_match = {}
    if start_date:
        date_match["$gte"] = start_date
    if end_date:
        date_match["$lte"] = end_date

    match_stage = {"location_id": location_id, "deleted_at": None}
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

    summary = await db.schedules.aggregate([
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
    ]).to_list(1)
    totals = summary[0] if summary else {
        "total_schedules": 0, "total_drive_minutes": 0, "total_class_minutes": 0,
        "completed": 0, "upcoming": 0, "in_progress": 0,
    }

    employee_breakdown = await db.schedules.aggregate([
        {"$match": match_stage},
        {"$group": {"_id": {"$ifNull": ["$employee_name", "Unknown"]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]).to_list(500)

    class_breakdown = await db.schedules.aggregate([
        {"$match": match_stage},
        {"$group": {"_id": {"$ifNull": ["$class_name", "Unassigned"]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]).to_list(500)

    recent_schedules = await db.schedules.find(
        match_stage, {"_id": 0},
    ).sort("date", -1).limit(10).to_list(10)

    return {
        "location": location,
        "total_schedules": totals["total_schedules"],
        "total_drive_minutes": totals["total_drive_minutes"],
        "total_class_minutes": totals["total_class_minutes"],
        "completed": totals["completed"],
        "upcoming": totals["upcoming"],
        "in_progress": totals["in_progress"],
        "employee_breakdown": employee_breakdown,
        "class_breakdown": class_breakdown,
        "recent_schedules": recent_schedules,
    }


@router.post(
    "/{location_id}/restore",
    summary="Restore a deleted location",
    responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}},
)
async def restore_location(location_id: str, user: AdminRequired):
    # ``restore`` returns False when the doc exists but isn't in a
    # deleted state, so we verify existence first for the 404 path.
    if not await locations_repo.restore(location_id):
        existing = await db.locations.find_one({"id": location_id}, {"_id": 1})
        if not existing:
            raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(
        "Location restored",
        extra={"entity": {"location_id": location_id}},
    )
    await log_activity(
        "location_restored", f"Location '{location_id}' restored",
        "location", location_id, user.get('name', 'System'),
    )
    return {"message": "Location restored"}
