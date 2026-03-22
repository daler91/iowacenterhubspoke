import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import LocationCreate, LocationUpdate, ErrorResponse
from core.auth import CurrentUser
from services.activity import log_activity

router = APIRouter(prefix="/locations", tags=["locations"])

LOCATION_NOT_FOUND = "Location not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

@router.get("")
async def get_locations(user: CurrentUser):
    locations = await db.locations.find({}, {"_id": 0}).to_list(100)
    return locations

@router.post("")
async def create_location(data: LocationCreate, user: CurrentUser):
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
    await log_activity("location_created", f"Location '{data.city_name}' added ({data.drive_time_minutes}m from Hub)", "location", loc_id, user.get('name', 'System'))
    return doc

@router.put("/{location_id}", responses={400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE}, 404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def update_location(location_id: str, data: LocationUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.locations.update_one({"id": location_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    updated = await db.locations.find_one({"id": location_id}, {"_id": 0})
    return updated

@router.delete("/{location_id}", responses={404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}})
async def delete_location(location_id: str, user: CurrentUser):
    result = await db.locations.delete_one({"id": location_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    return {"message": "Location deleted"}
