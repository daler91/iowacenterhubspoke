import uuid
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import WebhookCreate, WebhookUpdate
from core.auth import AdminRequired
from core.constants import WEBHOOK_EVENTS
from services.webhooks import deliver_webhook, validate_webhook_url
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

WEBHOOK_NOT_FOUND = "Webhook subscription not found"


@router.get("", summary="List webhook subscriptions")
async def list_webhooks(user: AdminRequired):
    items = (
        await db.webhook_subscriptions.find(
            {"deleted_at": None}, {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(100)
    )
    return {"items": items, "total": len(items)}


@router.post(
    "",
    summary="Create a webhook subscription",
    responses={400: {"description": "Invalid events"}},
)
async def create_webhook(data: WebhookCreate, user: AdminRequired):
    validate_webhook_url(data.url)
    # Validate events
    invalid = [e for e in data.events if e not in WEBHOOK_EVENTS]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid events: {', '.join(invalid)}",
        )

    now = datetime.now(timezone.utc).isoformat()
    secret = secrets.token_urlsafe(32)
    doc = {
        "id": str(uuid.uuid4()),
        "url": data.url,
        "secret": secret,
        "events": data.events,
        "active": data.active,
        "created_by": user.get("name", "System"),
        "created_at": now,
        "updated_at": now,
        "last_triggered_at": None,
        "failure_count": 0,
        "deleted_at": None,
    }
    await db.webhook_subscriptions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put(
    "/{webhook_id}",
    summary="Update a webhook subscription",
    responses={
        400: {"description": "No fields to update"},
        404: {"description": WEBHOOK_NOT_FOUND},
    },
)
async def update_webhook(
    webhook_id: str, data: WebhookUpdate, user: AdminRequired,
):
    update_data = {
        k: v for k, v in data.model_dump().items() if v is not None
    }
    if "url" in update_data:
        validate_webhook_url(update_data["url"])
    if not update_data:
        raise HTTPException(
            status_code=400, detail="No fields to update",
        )
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.webhook_subscriptions.update_one(
        {"id": webhook_id, "deleted_at": None},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=WEBHOOK_NOT_FOUND)
    updated = await db.webhook_subscriptions.find_one(
        {"id": webhook_id}, {"_id": 0},
    )
    return updated


@router.delete(
    "/{webhook_id}",
    summary="Delete a webhook subscription",
    responses={404: {"description": WEBHOOK_NOT_FOUND}},
)
async def delete_webhook(webhook_id: str, user: AdminRequired):
    result = await db.webhook_subscriptions.update_one(
        {"id": webhook_id, "deleted_at": None},
        {"$set": {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=WEBHOOK_NOT_FOUND)
    return {"message": "Webhook deleted"}


@router.get(
    "/{webhook_id}/logs",
    summary="View delivery logs for a subscription",
    responses={404: {"description": WEBHOOK_NOT_FOUND}},
)
async def get_webhook_logs(
    webhook_id: str,
    user: AdminRequired,
    skip: int = 0,
    limit: int = 50,
):
    total = await db.webhook_logs.count_documents(
        {"subscription_id": webhook_id},
    )
    logs = (
        await db.webhook_logs.find(
            {"subscription_id": webhook_id}, {"_id": 0},
        )
        .sort("sent_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    return {
        "items": logs, "total": total, "skip": skip, "limit": limit,
    }


@router.post(
    "/{webhook_id}/test",
    summary="Send a test webhook payload",
    responses={404: {"description": WEBHOOK_NOT_FOUND}},
)
async def test_webhook(webhook_id: str, user: AdminRequired):
    sub = await db.webhook_subscriptions.find_one(
        {"id": webhook_id, "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(status_code=404, detail=WEBHOOK_NOT_FOUND)
    await deliver_webhook(
        None, webhook_id, "test.ping",
        {"message": "Test webhook from Iowa Center Hub & Spoke"},
    )
    return {"message": "Test webhook sent"}


@router.get("/events", summary="List available webhook events")
async def list_events(user: AdminRequired):
    return {"events": WEBHOOK_EVENTS}
