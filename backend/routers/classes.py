import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Optional, List
from database import db
from models.schemas import ClassCreate, ClassUpdate
from core.auth import CurrentUser
from services.activity import log_activity

router = APIRouter(prefix="/classes", tags=["classes"])

CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

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
        "class_color": class_doc.get("color", "#0F766E"),
        "class_description": class_doc.get("description"),
    }

async def sync_class_snapshot(class_doc: dict):
    snapshot = get_class_snapshot(class_doc)
    await db.schedules.update_many(
        {"class_id": class_doc["id"]},
        {"$set": {
            "class_name": snapshot["class_name"],
            "class_color": snapshot["class_color"],
            "class_description": snapshot["class_description"],
        }}
    )

@router.get("")
async def get_classes(user: CurrentUser):
    classes = await db.classes.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return classes

@router.post("")
async def create_class(data: ClassCreate, user: CurrentUser):
    class_id = str(uuid.uuid4())
    doc = {
        "id": class_id,
        "name": data.name,
        "description": data.description,
        "color": data.color,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    await log_activity("class_created", f"Class type '{data.name}' added", "class", class_id, user.get('name', 'System'))
    return doc

@router.put("/{class_id}", responses={400: {"description": NO_FIELDS_TO_UPDATE}, 404: {"description": CLASS_NOT_FOUND}})
async def update_class(class_id: str, data: ClassUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    result = await db.classes.update_one({"id": class_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    updated = await db.classes.find_one({"id": class_id}, {"_id": 0})
    await sync_class_snapshot(updated)
    await log_activity("class_updated", f"Class type '{updated['name']}' updated", "class", class_id, user.get('name', 'System'))
    return updated

@router.delete("/{class_id}", responses={404: {"description": CLASS_NOT_FOUND}})
async def delete_class(class_id: str, user: CurrentUser):
    class_doc = await db.classes.find_one({"id": class_id}, {"_id": 0})
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
    await db.classes.delete_one({"id": class_id})
    await log_activity("class_deleted", f"Class type '{class_doc['name']}' deleted", "class", class_id, user.get('name', 'System'))
    return {"message": "Class deleted"}
