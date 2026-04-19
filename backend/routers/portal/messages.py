"""Partner portal messaging endpoints."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from core.logger import get_logger
from core.pagination import Paginated, paginated_response
from core.portal_auth import PortalContext
from database import db
from models.coordination_schemas import MessageCreate
from services.notification_events import notify_project_message_mentions
from services.notification_prefs import prepare_mentions

from ._shared import INVALID_TOKEN, PROJECT_NOT_FOUND

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])


async def _require_partner_project(project_id: str, ctx: dict) -> dict:
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


@router.get(
    "/projects/{project_id}/messages",
    summary="Messages for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_messages(
    project_id: str,
    ctx: PortalContext,
    pagination: Paginated,
    channel: Optional[str] = None,
):
    await _require_partner_project(project_id, ctx)

    query = {
        "project_id": project_id,
        "visibility": {"$ne": "internal"},
        "deleted_at": None,
    }
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
    "/projects/{project_id}/messages",
    summary="Partner sends a message",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_send_message(
    project_id: str, ctx: PortalContext, data: MessageCreate,
):
    project = await _require_partner_project(project_id, ctx)

    mentioned, stored_mentions = await prepare_mentions(
        project_id=project_id,
        refs_input=data.mentions,
        partner_org_id=project.get("partner_org_id"),
    )

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": msg_id,
        "project_id": project_id,
        "channel": data.channel,
        "sender_type": "partner",
        "sender_name": ctx["contact"]["name"],
        "sender_id": ctx["contact"]["id"],
        "body": data.body,
        "visibility": "shared",  # Partner messages are always visible to both sides
        "mentions": stored_mentions,
        "created_at": now,
        "read_by": [ctx["contact"]["id"]],
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    if mentioned:
        actor = {
            "id": ctx["contact"]["id"],
            "user_id": ctx["contact"]["id"],
            "name": ctx["contact"]["name"],
        }
        await notify_project_message_mentions(doc, project, actor, mentioned)
    return doc
