import uuid
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from database import db
from core.queue import get_redis_pool
from core.logger import get_logger

logger = get_logger(__name__)


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
            # Inline fallback (not recommended for production)
            try:
                await deliver_webhook(
                    None, sub["id"], event, payload,
                )
            except Exception as e:
                logger.error(
                    "Inline webhook delivery failed: %s", e,
                )


async def deliver_webhook(
    ctx, subscription_id: str, event: str, payload: dict,
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
            "Webhook delivery to %s failed: %s", url, e,
        )
