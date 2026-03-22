import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import LocationCreate, LocationUpdate, ErrorResponse
from core.auth import CurrentUser, AdminRequired
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/locations", tags=["locations"])

LOCATION_NOT_FOUND = "Location not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

@router.get("")
async def get_locations(user: CurrentUser, skip: int = 0, limit: int = 100):
    total = await db.locations.count_documents({})
    locations = await db.locations.find({}, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
    return {"items": locations, "total": total, "skip": skip, "limit": limit}

@router.post("")
async def create_location(data: LocationCreate, user: AdminRequired):
    loc_id = str(uuid.uuid4())
    doc = {
        "id": loc_id,
        "city_name": data.city_name,
        "drive_time_minutes": data.drive_time_minutes,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "created_at": datetime.now(timezone.utc).isoformat()
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
    return updated

@router.delete("/{location_id}", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def delete_location(location_id: str, user: AdminRequired):
    result = await db.locations.delete_one({"id": location_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    logger.info(f"Location deleted: {location_id}", extra={"entity": {"location_id": location_id}})
    return {"message": "Location deleted"}
