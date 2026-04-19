import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import MessageCreate
from core.auth import CurrentUser, EditorRequired
from core.pagination import Paginated, paginated_response
from services.notification_events import (
    notify_project_message,
    notify_project_message_mentions,
)
from services.notification_prefs import resolve_mention_principals
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
    pagination: Paginated,
    channel: Optional[str] = None,
):
    query: dict = {"project_id": project_id, "deleted_at": None}
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
async def send_message(project_id: str, data: MessageCreate, user: EditorRequired):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    mention_refs = [m.model_dump() for m in (data.mentions or [])]
    mentioned = await resolve_mention_principals(
        project_id=project_id,
        refs=mention_refs,
        partner_org_id=project.get("partner_org_id"),
    )
    stored_mentions = [
        {"id": p.id, "kind": p.kind, "name": p.name or ""}
        for p in mentioned
    ]

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    # JWT payload exposes the user id under ``user_id`` — there is
    # no ``id`` key. The previous ``user.get("id", "")`` persisted the
    # empty string on every message, which broke the anonymization
    # filter in /auth/me AND made read_by=[""] match every subsequent
    # reader whose id was also "".
    sender_uid = user.get("user_id", "")
    doc = {
        "id": msg_id,
        "project_id": project_id,
        "channel": data.channel,
        "sender_type": "internal",
        "sender_name": user.get("name", "Unknown"),
        "sender_id": sender_uid,
        "body": data.body,
        "visibility": data.visibility,
        "mentions": stored_mentions,
        "created_at": now,
        "read_by": [sender_uid] if sender_uid else [],
        "deleted_at": None,
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    mention_ids = {p.id for p in mentioned}
    await notify_project_message(doc, project, user, mention_ids=mention_ids)
    if mentioned:
        await notify_project_message_mentions(doc, project, user, mentioned)
    return doc
