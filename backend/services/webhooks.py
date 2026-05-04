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
from core.token_vault import decrypt_token

logger = get_logger(__name__)

ALLOWED_WEBHOOK_SCHEMES = {"https"}
WEBHOOK_TIMEOUT_SECONDS = 10.0
WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024


def _safe_sub_id(sid: str) -> str:
    """Return a canonical UUID string for logging, or a placeholder if invalid."""
    try:
        return str(uuid.UUID(str(sid)))
    except (ValueError, AttributeError, TypeError):
        return "invalid-id"


def _is_denied_webhook_ip(ip: ipaddress._BaseAddress) -> bool:
    """Return True when an IP falls inside denied SSRF-sensitive ranges."""
    if ip.is_private or ip.is_loopback or ip.is_link_local:
        return True
    if ip.is_reserved or ip.is_multicast or ip.is_unspecified:
        return True
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        return True
    return False


def _resolve_hostname_ips(hostname: str) -> list[ipaddress._BaseAddress]:
    """Resolve all IPs for a hostname across address families."""
    try:
        addr_infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="Cannot resolve webhook URL hostname") from exc

    ips: list[ipaddress._BaseAddress] = []
    for info in addr_infos:
        sockaddr = info[4]
        if not sockaddr:
            continue
        raw_ip = sockaddr[0]
        try:
            ips.append(ipaddress.ip_address(raw_ip))
        except ValueError:
            continue
    if not ips:
        raise HTTPException(status_code=400, detail="Cannot resolve webhook URL hostname")
    return ips


def validate_webhook_url(url: str) -> None:
    """Validate HTTPS webhook URL and block internal/unsafe destinations."""
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ALLOWED_WEBHOOK_SCHEMES:
        raise HTTPException(status_code=400, detail="Webhook URL must use HTTPS")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid webhook URL")

    for ip in _resolve_hostname_ips(parsed.hostname):
        if _is_denied_webhook_ip(ip):
            raise HTTPException(status_code=400, detail="Webhook URL must not target private/internal networks")


def _validate_response_location(location: str) -> None:
    """Validate any redirect target location before following it."""
    parsed = urlparse(location)
    if not parsed.scheme or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Webhook redirect target must be an absolute HTTPS URL")
    if parsed.scheme.lower() not in ALLOWED_WEBHOOK_SCHEMES:
        raise HTTPException(status_code=400, detail="Webhook redirect target must use HTTPS")
    for ip in _resolve_hostname_ips(parsed.hostname):
        if _is_denied_webhook_ip(ip):
            raise HTTPException(status_code=400, detail="Webhook redirect target is blocked")


def _validate_redirect_target(resp) -> None:
    location = resp.headers.get("location")
    if not location:
        return
    _validate_response_location(location)


def _truncate_response(content: bytes) -> str:
    return content[:WEBHOOK_MAX_RESPONSE_BYTES].decode("utf-8", errors="replace")


def _default_timeout():
    import httpx
    return httpx.Timeout(connect=WEBHOOK_TIMEOUT_SECONDS, read=WEBHOOK_TIMEOUT_SECONDS, write=WEBHOOK_TIMEOUT_SECONDS, pool=WEBHOOK_TIMEOUT_SECONDS)


def _default_limits():
    import httpx
    return httpx.Limits(max_keepalive_connections=10, max_connections=20)


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
        logger.warning("Webhook delivery skipped — URL failed SSRF validation")
        return
    # Secret is Fernet-encrypted at rest; decrypt at signing time.
    raw_secret = sub.get("secret", "") or ""
    secret = decrypt_token(raw_secret) if raw_secret else ""
    body = json.dumps({"event": event, "data": payload})

    # HMAC signature
    signature = hmac.new(
        secret.encode(), body.encode(), hashlib.sha256,
    ).hexdigest()

    log_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    start = time.monotonic()

    try:
        async with httpx.AsyncClient(
            timeout=_default_timeout(),
            limits=_default_limits(),
            follow_redirects=False,
        ) as client:
            resp = await client.post(
                url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": f"sha256={signature}",
                    "X-Webhook-Event": event,
                },
            )
            if 300 <= resp.status_code < 400:
                _validate_redirect_target(resp)
            response_content = await resp.aread()
        duration = int((time.monotonic() - start) * 1000)
        success = 200 <= resp.status_code < 300

        await db.webhook_logs.insert_one({
            "id": log_id,
            "subscription_id": subscription_id,
            "event": event,
            "payload": payload,
            "status_code": resp.status_code,
            "response_body": _truncate_response(response_content),
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
                    _safe_sub_id(subscription_id),
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
            _safe_sub_id(subscription_id),
            type(e).__name__,
        )
