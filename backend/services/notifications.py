"""Notification dispatcher + inbox helpers.

Every feature that emits a user-facing notification should call
``dispatch(type_key, principal, event)``. The dispatcher:

1. Looks up the type in the registry (unknown → logged + skipped).
2. For each allowed channel, consults the principal's stored prefs to pick
   a frequency.
3. Acts:

   - ``instant`` + ``in_app``  → insert a row into ``db.notifications``.
   - ``instant`` + ``email``   → send via ``services.email.send_notification_email``.
   - ``daily`` / ``weekly``    → enqueue a row in ``db.notification_queue``
     for the digest worker to flush.
   - ``off``                   → do nothing.

Dedup
-----
Callers may pass ``dedup_key`` on the event to guarantee idempotency per
(principal, type, channel). We store sent-records in
``db.notifications_sent`` with a unique compound index; duplicate dispatch
attempts are a no-op. Task reminders use ``f"{task_id}:{threshold_key}"``.

Transactional types
-------------------
``transactional=True`` entries are NOT routed through this dispatcher — the
direct ``services.email`` helpers still send those. If a caller does pass a
transactional key, we still honour it by sending unconditionally through the
email path (but log a warning — the direct helper is preferred).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from core.logger import get_logger
from core.notification_types import (
    Channel,
    Frequency,
    get_type,
)
from database import db
from services.notification_prefs import (
    Principal,
    PrincipalKind,
    get_frequency,
)


logger = get_logger(__name__)


# ── Event payload ──────────────────────────────────────────────────────

@dataclass
class NotificationEvent:
    """Payload passed to :func:`dispatch`.

    ``title`` / ``body`` are **plaintext** and are what land in the in-app
    inbox (React renders them as text, so no HTML sanitisation needed on
    the client). ``email_body_html`` is the HTML version used by the
    email channel; if omitted, the dispatcher wraps ``body`` in a minimal
    ``<p>`` block.
    """

    type_key: str
    title: str
    body: str
    email_body_html: Optional[str] = None
    link: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    severity: str = "info"
    dedup_key: Optional[str] = None  # per-(principal,type,channel) idempotency
    context: dict = field(default_factory=dict)  # free-form extras for email templates

    def html_for_email(self) -> str:
        """Return the HTML body used by the email channel."""
        if self.email_body_html:
            return self.email_body_html
        # Plaintext → escaped HTML paragraph. Prevents injection when a
        # caller didn't supply a pre-rendered HTML version.
        from html import escape
        return f"<p>{escape(self.body)}</p>"


# ── Dedup ──────────────────────────────────────────────────────────────

async def _was_already_sent(principal: Principal, event: NotificationEvent, channel: Channel) -> bool:
    if not event.dedup_key:
        return False
    existing = await db.notifications_sent.find_one({
        "principal_kind": principal.kind,
        "principal_id": principal.id,
        "type_key": event.type_key,
        "channel": channel,
        "dedup_key": event.dedup_key,
    })
    return existing is not None


async def _record_sent(
    principal: Principal,
    event: NotificationEvent,
    channel: Channel,
    outcome: str,
) -> None:
    if not event.dedup_key:
        return
    try:
        await db.notifications_sent.insert_one({
            "id": str(uuid.uuid4()),
            "principal_kind": principal.kind,
            "principal_id": principal.id,
            "type_key": event.type_key,
            "channel": channel,
            "dedup_key": event.dedup_key,
            "outcome": outcome,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:  # unique index collision — another worker beat us
        logger.debug("notifications_sent record skipped (race): %s", e)


# ── In-app inbox ───────────────────────────────────────────────────────

async def _persist_inbox(principal: Principal, event: NotificationEvent) -> str:
    notif_id = str(uuid.uuid4())
    await db.notifications.insert_one({
        "id": notif_id,
        "principal_kind": principal.kind,
        "principal_id": principal.id,
        "type_key": event.type_key,
        "title": event.title,
        "body": event.body,
        "link": event.link,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "severity": event.severity,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read_at": None,
        "dismissed_at": None,
    })
    return notif_id


# ── Queue for digests ──────────────────────────────────────────────────

async def _enqueue_for_digest(
    principal: Principal,
    event: NotificationEvent,
    channel: Channel,
    frequency: Frequency,
) -> str:
    queue_id = str(uuid.uuid4())
    await db.notification_queue.insert_one({
        "id": queue_id,
        "principal_kind": principal.kind,
        "principal_id": principal.id,
        "principal_email": principal.email,
        "principal_name": principal.name,
        "type_key": event.type_key,
        "channel": channel,
        "frequency": frequency,
        "title": event.title,
        "body": event.body,
        "link": event.link,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "severity": event.severity,
        "context": event.context,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sent_at": None,
    })
    return queue_id


# ── Instant email ──────────────────────────────────────────────────────

async def _send_instant_email(principal: Principal, event: NotificationEvent) -> bool:
    if not principal.email:
        logger.info(
            "Skipping email for %s principal %s — no email on record",
            principal.kind, principal.id,
        )
        return False
    from services.email import send_notification_email
    return await send_notification_email(
        to=principal.email,
        name=principal.name or "there",
        title=event.title,
        body_html=event.html_for_email(),
        link=event.link,
    )


# ── Public entry point ─────────────────────────────────────────────────

@dataclass
class DispatchResult:
    in_app: str  # "sent" | "queued" | "off" | "skipped" | "deduped" | "unsupported"
    email: str


async def _deliver_channel(
    principal: Principal,
    event: NotificationEvent,
    channel: Channel,
    frequency: Frequency,
) -> str:
    """Deliver ``event`` on a single channel and return the outcome."""
    if frequency == "instant":
        if channel == "in_app":
            await _persist_inbox(principal, event)
            return "sent"
        ok = await _send_instant_email(principal, event)
        return "sent" if ok else "skipped"
    # daily | weekly
    if channel == "in_app":
        # In-app has no digest concept — degrade to instant.
        await _persist_inbox(principal, event)
        return "sent"
    await _enqueue_for_digest(principal, event, channel, frequency)
    return "queued"


async def _dispatch_channel(
    principal: Principal,
    event: NotificationEvent,
    channel: Channel,
) -> str:
    freq = get_frequency(principal, event.type_key, channel)
    if freq == "off":
        return "off"
    if await _was_already_sent(principal, event, channel):
        return "deduped"
    outcome = await _deliver_channel(principal, event, channel, freq)
    await _record_sent(principal, event, channel, outcome)
    return outcome


async def dispatch(principal: Principal, event: NotificationEvent) -> DispatchResult:
    """Dispatch a notification to ``principal`` for event ``event``.

    Safe to call without an awaited result — but callers should await to
    avoid uncontrolled background coroutines.
    """
    t = get_type(event.type_key)
    if t is None:
        logger.warning("dispatch() called with unknown type %s", event.type_key)
        return DispatchResult(in_app="unsupported", email="unsupported")
    if t.get("transactional"):
        # Preferences don't apply; we still honour the dispatch by emailing
        # unconditionally, but log a warning so callers move to the direct
        # helper.
        logger.warning(
            "dispatch() called for transactional type %s — prefer services.email.*",
            event.type_key,
        )
        email_outcome = "sent" if await _send_instant_email(principal, event) else "skipped"
        return DispatchResult(in_app="unsupported", email=email_outcome)

    in_app_outcome = await _dispatch_channel(principal, event, "in_app")
    email_outcome = await _dispatch_channel(principal, event, "email")
    return DispatchResult(in_app=in_app_outcome, email=email_outcome)


# ── Inbox helpers used by the router ───────────────────────────────────

async def list_inbox(
    principal_kind: PrincipalKind,
    principal_id: str,
    include_dismissed: bool = False,
    limit: int = 50,
) -> list[dict]:
    q: dict = {
        "principal_kind": principal_kind,
        "principal_id": principal_id,
    }
    if not include_dismissed:
        q["dismissed_at"] = None
    cursor = db.notifications.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(limit)


async def count_unread(principal_kind: PrincipalKind, principal_id: str) -> int:
    return await db.notifications.count_documents({
        "principal_kind": principal_kind,
        "principal_id": principal_id,
        "read_at": None,
        "dismissed_at": None,
    })


async def mark_read(
    principal_kind: PrincipalKind,
    principal_id: str,
    notification_id: str,
) -> bool:
    result = await db.notifications.update_one(
        {"id": notification_id, "principal_kind": principal_kind, "principal_id": principal_id},
        {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.matched_count > 0


async def dismiss(
    principal_kind: PrincipalKind,
    principal_id: str,
    notification_id: str,
) -> bool:
    result = await db.notifications.update_one(
        {"id": notification_id, "principal_kind": principal_kind, "principal_id": principal_id},
        {"$set": {"dismissed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.matched_count > 0


async def mark_all_read(principal_kind: PrincipalKind, principal_id: str) -> int:
    result = await db.notifications.update_many(
        {
            "principal_kind": principal_kind,
            "principal_id": principal_id,
            "read_at": None,
        },
        {"$set": {"read_at": datetime.now(timezone.utc).isoformat()}},
    )
    return result.modified_count
