import uuid
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from database import db
from models.coordination_schemas import WebhookCreate, WebhookUpdate
from core.auth import AdminRequired
from core.constants import WEBHOOK_EVENTS
from core.pagination import Paginated, paginated_response
from core.rate_limit import limiter
from core.token_vault import encrypt_token
from services.webhooks import deliver_webhook, validate_webhook_url
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

WEBHOOK_NOT_FOUND = "Webhook subscription not found"


def _mask_secret(doc: dict) -> dict:
    """Strip the webhook secret from an outbound response payload.

    The secret is shown in full exactly once at creation time (so the
    admin can configure their receiver) and never surfaced again.
    """
    if not doc:
        return doc
    doc.pop("secret", None)
    return doc


@router.get("", summary="List webhook subscriptions")
async def list_webhooks(user: AdminRequired):
    items = (
        await db.webhook_subscriptions.find(
            {"deleted_at": None}, {"_id": 0, "secret": 0},
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
    # Store the secret encrypted at rest (Fernet via TOKEN_ENCRYPTION_KEY
    # in production, plaintext in dev). Subsequent webhook deliveries
    # decrypt before HMAC signing.
    doc = {
        "id": str(uuid.uuid4()),
        "url": data.url,
        "secret": encrypt_token(secret),
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
    # Return the plaintext secret EXACTLY ONCE so the admin can configure
    # their receiver. It is not stored or returned in plaintext again.
    doc["secret"] = secret
    doc["secret_shown_once"] = True
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
        {"id": webhook_id}, {"_id": 0, "secret": 0},
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
    pagination: Paginated,
):
    total = await db.webhook_logs.count_documents(
        {"subscription_id": webhook_id},
    )
    logs = (
        await db.webhook_logs.find(
            {"subscription_id": webhook_id}, {"_id": 0},
        )
        .sort("sent_at", -1)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    return paginated_response(logs, total, pagination)


@router.post(
    "/{webhook_id}/test",
    summary="Send a test webhook payload",
    responses={404: {"description": WEBHOOK_NOT_FOUND}},
)
@limiter.limit("6/minute")
async def test_webhook(request: Request, webhook_id: str, user: AdminRequired):
    """Send a synthetic ping to the subscriber. Rate-limited so a misconfigured
    or malicious admin can't hammer a partner's receiver."""
    sub = await db.webhook_subscriptions.find_one(
        {"id": webhook_id, "deleted_at": None}, {"_id": 0},
    )
    if not sub:
        raise HTTPException(status_code=404, detail=WEBHOOK_NOT_FOUND)
    await deliver_webhook(
        None, webhook_id, "test.ping",
        {"message": "Test webhook from HubSpoke"},
    )
    return {"message": "Test webhook sent"}


@router.get("/events", summary="List available webhook events")
async def list_events(user: AdminRequired):
    return {"events": WEBHOOK_EVENTS}


@router.post(
    "/{webhook_id}/rotate-secret",
    summary="Rotate the HMAC signing secret for a webhook",
    responses={404: {"description": WEBHOOK_NOT_FOUND}},
)
async def rotate_webhook_secret(webhook_id: str, user: AdminRequired):
    """Mint a new signing secret, replace the encrypted value at rest,
    and return the plaintext EXACTLY ONCE so the admin can update
    their receiver. In-flight deliveries signed with the old secret
    will fail verification at the receiver after rotation — schedule
    rotations in a maintenance window or coordinate with partners."""
    sub = await db.webhook_subscriptions.find_one(
        {"id": webhook_id, "deleted_at": None}, {"_id": 0, "id": 1},
    )
    if not sub:
        raise HTTPException(status_code=404, detail=WEBHOOK_NOT_FOUND)

    new_secret = secrets.token_urlsafe(32)
    await db.webhook_subscriptions.update_one(
        {"id": webhook_id},
        {"$set": {
            "secret": encrypt_token(new_secret),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    logger.warning(
        "Webhook secret rotated",
        extra={"entity": {
            "webhook_id": webhook_id,
            "admin": user.get("email"),
        }},
    )
    return {
        "secret": new_secret,
        "secret_shown_once": True,
        "message": "Store this secret now — it cannot be retrieved later.",
    }
