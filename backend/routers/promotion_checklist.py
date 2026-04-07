import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import (
    PromotionChecklistItemCreate, PromotionChecklistItemToggle,
)
from core.auth import CurrentUser
from core.constants import DEFAULT_PROMOTION_CHANNELS
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/promotion-checklist",
    tags=["promotion"],
)

PROJECT_NOT_FOUND = "Project not found"
ITEM_NOT_FOUND = "Checklist item not found"


async def _get_or_create_checklist(project_id: str):
    """Get existing checklist or auto-create from defaults."""
    checklist = await db.promotion_checklists.find_one(
        {"project_id": project_id}, {"_id": 0},
    )
    if checklist:
        return checklist

    now = datetime.now(timezone.utc).isoformat()
    items = []
    for ch in DEFAULT_PROMOTION_CHANNELS:
        items.append({
            "id": str(uuid.uuid4()),
            "channel": ch["channel"],
            "label": ch["label"],
            "owner": ch.get("owner", "both"),
            "internal_done": False,
            "internal_done_at": None,
            "partner_done": False,
            "partner_done_at": None,
            "notes": "",
            "due_date": None,
        })
    doc = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "items": items,
        "created_at": now,
        "updated_at": now,
    }
    await db.promotion_checklists.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get(
    "",
    summary="Get promotion checklist for a project",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def get_checklist(project_id: str, user: CurrentUser):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return await _get_or_create_checklist(project_id)


@router.post(
    "/items",
    summary="Add a custom checklist item",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def add_item(
    project_id: str,
    data: PromotionChecklistItemCreate,
    user: CurrentUser,
):
    await _get_or_create_checklist(project_id)
    new_item = {
        "id": str(uuid.uuid4()),
        "channel": data.channel,
        "label": data.label,
        "owner": data.owner,
        "internal_done": False,
        "internal_done_at": None,
        "partner_done": False,
        "partner_done_at": None,
        "notes": data.notes or "",
        "due_date": data.due_date,
    }
    now = datetime.now(timezone.utc).isoformat()
    await db.promotion_checklists.update_one(
        {"project_id": project_id},
        {
            "$push": {"items": new_item},
            "$set": {"updated_at": now},
        },
    )
    return new_item


@router.patch(
    "/items/{item_id}/toggle",
    summary="Toggle completion for internal or partner side",
    responses={404: {"description": ITEM_NOT_FOUND}},
)
async def toggle_item(
    project_id: str,
    item_id: str,
    data: PromotionChecklistItemToggle,
    user: CurrentUser,
):
    doc = await db.promotion_checklists.find_one(
        {"project_id": project_id}, {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)

    now = datetime.now(timezone.utc).isoformat()
    field = f"{data.side}_done"
    field_at = f"{data.side}_done_at"

    # Find item and toggle
    for item in doc.get("items", []):
        if item["id"] == item_id:
            new_val = not item.get(field, False)
            await db.promotion_checklists.update_one(
                {
                    "project_id": project_id,
                    "items.id": item_id,
                },
                {
                    "$set": {
                        f"items.$.{field}": new_val,
                        f"items.$.{field_at}": (
                            now if new_val else None
                        ),
                        "updated_at": now,
                    },
                },
            )
            item[field] = new_val
            item[field_at] = now if new_val else None
            return item

    raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)


@router.delete(
    "/items/{item_id}",
    summary="Remove a checklist item",
    responses={404: {"description": ITEM_NOT_FOUND}},
)
async def delete_item(
    project_id: str, item_id: str, user: CurrentUser,
):
    result = await db.promotion_checklists.update_one(
        {"project_id": project_id},
        {
            "$pull": {"items": {"id": item_id}},
            "$set": {
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        },
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND)
    return {"message": "Item removed"}
