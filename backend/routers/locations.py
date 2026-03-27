import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import LocationCreate, LocationUpdate, ErrorResponse
from core.auth import CurrentUser, AdminRequired
from services.activity import log_activity
from services.drive_time import get_drive_time_between_locations, get_drive_time_from_hub
from core.logger import get_logger
from core.queue import get_redis_pool

logger = get_logger(__name__)

router = APIRouter(prefix="/locations", tags=["locations"])

LOCATION_NOT_FOUND = "Location not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

@router.get("")
async def get_locations(user: CurrentUser, skip: int = 0, limit: int = 100):
    query = {"deleted_at": None}
    total = await db.locations.count_documents(query)
    locations = await db.locations.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
    return {"items": locations, "total": total, "skip": skip, "limit": limit}

@router.get("/drive-time")
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


@router.get("/{location_id}", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def get_location(location_id: str, user: CurrentUser):
    location = await db.locations.find_one({"id": location_id, "deleted_at": None}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    return location

@router.post("")
async def create_location(data: LocationCreate, user: AdminRequired):
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
    logger.info(f"Location created: {data.city_name}", extra={"entity": {"location_id": loc_id}})
    await log_activity("location_created", f"Location '{data.city_name}' added ({data.drive_time_minutes}m from Hub)", "location", loc_id, user.get('name', 'System'))
    return doc

@router.put("/{location_id}", responses={400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE}, 404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def update_location(location_id: str, data: LocationUpdate, user: AdminRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.locations.update_one({"id": location_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(f"Location updated: {location_id}", extra={"entity": {"location_id": location_id}})
    updated = await db.locations.find_one({"id": location_id}, {"_id": 0})
    
    # Trigger background sync for denormalized fields
    pool = await get_redis_pool()
    if pool:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="location", entity_id=location_id)
    else:
        # Fallback: sync inline when Redis/worker isn't available
        await db.schedules.update_many(
            {"location_id": location_id},
            {"$set": {
                "location_name": updated["city_name"],
                "drive_time_minutes": updated["drive_time_minutes"],
            }},
        )
        logger.info(f"Inline sync completed for location {location_id}")

    return updated

@router.delete("/{location_id}", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def delete_location(location_id: str, user: AdminRequired):
    result = await db.locations.update_one(
        {"id": location_id, "deleted_at": None}, 
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(f"Location soft-deleted: {location_id}", extra={"entity": {"location_id": location_id}})
    await log_activity("location_deleted", f"Location '{location_id}' marked as deleted", "location", location_id, user.get('name', 'System'))
    return {"message": "Location deleted"}

@router.get("/{location_id}/stats", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def get_location_stats(location_id: str, user: CurrentUser, start_date: Optional[str] = None, end_date: Optional[str] = None):
    location = await db.locations.find_one({"id": location_id, "deleted_at": None}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    all_schedules = await db.schedules.find({"location_id": location_id, "deleted_at": None}, {"_id": 0}).to_list(1000)
    if start_date:
        all_schedules = [s for s in all_schedules if s.get('date', '') >= start_date]
    if end_date:
        all_schedules = [s for s in all_schedules if s.get('date', '') <= end_date]
    total_schedules = len(all_schedules)
    total_drive_minutes = 0
    total_class_minutes = 0
    completed = 0
    upcoming = 0
    in_progress = 0
    emp_counts = {}
    class_counts = {}

    for s in all_schedules:
        total_drive_minutes += s.get('drive_time_minutes', 0) * 2
        try:
            sh, sm = s['start_time'].split(':')
            eh, em = s['end_time'].split(':')
            total_class_minutes += (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
        except (ValueError, KeyError):
            pass

        status = s.get('status', 'upcoming')
        if status == 'completed':
            completed += 1
        elif status == 'upcoming':
            upcoming += 1
        elif status == 'in_progress':
            in_progress += 1

        emp_name = s.get('employee_name', 'Unknown')
        emp_counts[emp_name] = emp_counts.get(emp_name, 0) + 1

        class_name = s.get('class_name') or 'Unassigned'
        class_counts[class_name] = class_counts.get(class_name, 0) + 1

    return {
        "location": location,
        "total_schedules": total_schedules,
        "total_drive_minutes": total_drive_minutes,
        "total_class_minutes": total_class_minutes,
        "completed": completed,
        "upcoming": upcoming,
        "in_progress": in_progress,
        "employee_breakdown": [{"name": k, "count": v} for k, v in emp_counts.items()],
        "class_breakdown": [{"name": k, "count": v} for k, v in class_counts.items()],
        "recent_schedules": sorted(all_schedules, key=lambda x: x.get('date', ''), reverse=True)[:10]
    }

@router.post("/{location_id}/restore", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def restore_location(location_id: str, user: AdminRequired):
    result = await db.locations.update_one(
        {"id": location_id}, 
        {"$set": {"deleted_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(f"Location restored: {location_id}", extra={"entity": {"location_id": location_id}})
    await log_activity("location_restored", f"Location '{location_id}' restored", "location", location_id, user.get('name', 'System'))
    return {"message": "Location restored"}
