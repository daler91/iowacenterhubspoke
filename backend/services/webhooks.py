import uuid
import hashlib
import hmac
import ipaddress
import json
import socket
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import HTTPException
from database import db
from core.queue import get_redis_pool
from core.logger import get_logger

logger = get_logger(__name__)


def validate_webhook_url(url: str) -> None:
    """Validate that a webhook URL is HTTPS and does not target private networks."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Webhook URL must use HTTPS")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid webhook URL")
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(parsed.hostname))
    except (socket.gaierror, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Cannot resolve webhook URL hostname") from exc
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        raise HTTPException(status_code=400, detail="Webhook URL must not target private/internal networks")


async def fire_webhook_event(event: str, payload: dict):
    """Look up active subscriptions for the event and enqueue delivery."""
    subs = await db.webhook_subscriptions.find(
        {
            "active": True,
            "events": event,
            "deleted_at": None,
        },
        {"_id": 0, "id": 1},
    ).to_list(100)

    if not subs:
        return

    pool = await get_redis_pool()
    for sub in subs:
        if pool:
            await pool.enqueue_job(
                "deliver_webhook", sub["id"], event, payload,
            )
        else:
            # Persist to outbox for async processing (Redis unavailable)
            await db.webhook_outbox.insert_one({
                "id": str(uuid.uuid4()),
                "subscription_id": sub["id"],
                "event": event,
                "payload": payload,
                "status": "pending",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info("Webhook queued to outbox (Redis unavailable)")


async def deliver_webhook(
    _ctx, subscription_id: str, event: str, payload: dict,
):
    """Deliver a webhook to the subscriber's URL."""
    import httpx

    sub = await db.webhook_subscriptions.find_one(
        {"id": subscription_id, "active": True, "deleted_at": None},
        {"_id": 0},
    )
    if not sub:
        return

    url = sub["url"]
    # SSRF check at delivery time (defense in depth)
    try:
        validate_webhook_url(url)
    except HTTPException:
        logger.warning("Webhook %s has invalid URL %s — skipping delivery", subscription_id, url)
        return
    secret = sub.get("secret", "")
    body = json.dumps({"event": event, "data": payload})

    # HMAC signature
    signature = hmac.new(
        secret.encode(), body.encode(), hashlib.sha256,
    ).hexdigest()

    log_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    start = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": f"sha256={signature}",
                    "X-Webhook-Event": event,
                },
            )
        duration = int((time.monotonic() - start) * 1000)
        success = 200 <= resp.status_code < 300

        await db.webhook_logs.insert_one({
            "id": log_id,
            "subscription_id": subscription_id,
            "event": event,
            "payload": payload,
            "status_code": resp.status_code,
            "response_body": resp.text[:500],
            "success": success,
            "error": None,
            "sent_at": now,
            "duration_ms": duration,
        })

        if success:
            await db.webhook_subscriptions.update_one(
                {"id": subscription_id},
                {
                    "$set": {"last_triggered_at": now},
                    "$unset": {"failure_count": ""},
                },
            )
        else:
            await db.webhook_subscriptions.update_one(
                {"id": subscription_id},
                {"$inc": {"failure_count": 1}},
            )
            # Auto-disable on 10+ failures
            sub_updated = await db.webhook_subscriptions.find_one(
                {"id": subscription_id}, {"failure_count": 1},
            )
            if (sub_updated or {}).get("failure_count", 0) >= 10:
                await db.webhook_subscriptions.update_one(
                    {"id": subscription_id},
                    {"$set": {"active": False}},
                )
                logger.warning(
                    "Webhook %s auto-disabled after 10+ failures",
                    subscription_id,
                )

    except Exception as e:
        duration = int((time.monotonic() - start) * 1000)
        await db.webhook_logs.insert_one({
            "id": log_id,
            "subscription_id": subscription_id,
            "event": event,
            "payload": payload,
            "status_code": None,
            "response_body": None,
            "success": False,
            "error": str(e)[:500],
            "sent_at": now,
            "duration_ms": duration,
        })
        await db.webhook_subscriptions.update_one(
            {"id": subscription_id},
            {"$inc": {"failure_count": 1}},
        )
        logger.error(
            "Webhook delivery to subscription %s failed: %s",
            subscription_id, type(e).__name__,
        )
