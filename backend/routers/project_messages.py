import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from database import db
from models.coordination_schemas import MessageCreate
from core.auth import CurrentUser
from core.pagination import PaginationParams, pagination_params, paginated_response
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/messages", tags=["project-messages"])

PROJECT_NOT_FOUND = "Project not found"


@router.get(
    "/channels",
    summary="List available channels for a project",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def list_channels(project_id: str, user: CurrentUser):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None}, {"_id": 0, "title": 1})
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    channels = [project.get("title", "General"), "general"]
    existing = await db.messages.distinct("channel", {"project_id": project_id})
    for ch in existing:
        if ch not in channels:
            channels.append(ch)
    return {"channels": channels}


@router.get("", summary="List messages for a project")
async def list_messages(
    project_id: str,
    user: CurrentUser,
    channel: Optional[str] = None,
    pagination: PaginationParams = Depends(pagination_params),
):
    query: dict = {"project_id": project_id}
    if channel:
        query["channel"] = channel
    total = await db.messages.count_documents(query)
    messages = (
        await db.messages.find(query, {"_id": 0})
        .sort("created_at", 1)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    return paginated_response(messages, total, pagination)


@router.post(
    "",
    summary="Send a message",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def send_message(project_id: str, data: MessageCreate, user: CurrentUser):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": msg_id,
        "project_id": project_id,
        "channel": data.channel,
        "sender_type": "internal",
        "sender_name": user.get("name", "Unknown"),
        "sender_id": user.get("id", ""),
        "body": data.body,
        "visibility": data.visibility,
        "created_at": now,
        "read_by": [user.get("id", "")],
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc
