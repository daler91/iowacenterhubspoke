"""Digest worker — flushes queued notifications at each user's chosen time.

The dispatcher enqueues a row in ``db.notification_queue`` whenever a
recipient has asked for ``daily`` or ``weekly`` delivery of a type. This
module's :func:`process_digests` cron runs hourly:

- Groups pending rows by ``(principal_kind, principal_id, frequency)``.
- For each group, checks whether "now" matches the principal's configured
  ``digest.daily_hour`` / ``digest.weekly_day`` (defaults applied).
- If yes, sends one digest email containing every queued item and deletes
  the rows.
- Failures leave rows in place to retry on the next hour — idempotent.

Timezones
---------
MVP stores digest times as naive hour/weekday values interpreted in the
server's local clock (UTC in the deployed env). That's good enough for a
single-org tenant in one timezone. A follow-up can promote to tz-aware
storage per user.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from core.logger import get_logger
from database import db
from services.notification_prefs import (
    DEFAULT_DIGEST,
    VALID_WEEKDAYS,
    load_principal,
)


logger = get_logger(__name__)

_WEEKDAY_FROM_INT = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


Frequency = Literal["daily", "weekly"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _should_flush(
    principal_kind: str,
    principal_id: str,
    frequency: Frequency,
    now: datetime,
) -> bool:
    p = await load_principal(principal_kind, principal_id)  # type: ignore[arg-type]
    if p is None:
        # Principal deleted — flush to clear the queue.
        return True
    digest = (p.prefs or {}).get("digest") or {}
    daily_hour = digest.get("daily_hour")
    if not isinstance(daily_hour, int) or not (0 <= daily_hour <= 23):
        daily_hour = DEFAULT_DIGEST["daily_hour"]
    weekly_day = digest.get("weekly_day")
    if weekly_day not in VALID_WEEKDAYS:
        weekly_day = DEFAULT_DIGEST["weekly_day"]

    if frequency == "daily":
        return now.hour == daily_hour
    # weekly — fire on configured day at the configured hour
    return (
        _WEEKDAY_FROM_INT[now.weekday()] == weekly_day
        and now.hour == daily_hour
    )


async def _send_digest_and_clear(
    principal_kind: str,
    principal_id: str,
    frequency: Frequency,
    rows: list[dict],
) -> bool:
    p = await load_principal(principal_kind, principal_id)  # type: ignore[arg-type]
    if p is None or not p.email:
        # Can't deliver — still clear the queue so it doesn't build up.
        await db.notification_queue.delete_many(
            {"id": {"$in": [r["id"] for r in rows]}},
        )
        return False

    from services.email import send_digest_email
    ok = await send_digest_email(
        to=p.email,
        name=p.name or "there",
        frequency=frequency,
        items=[
            {
                "title": r.get("title", ""),
                "body": r.get("body", ""),
                "link": r.get("link"),
                "type_key": r.get("type_key", ""),
                "created_at": r.get("created_at", ""),
            }
            for r in rows
        ],
    )
    if ok:
        await db.notification_queue.delete_many(
            {"id": {"$in": [r["id"] for r in rows]}},
        )
    else:
        # Mark the rows so we can tell on next run this was a failed send.
        await db.notification_queue.update_many(
            {"id": {"$in": [r["id"] for r in rows]}},
            {"$set": {"last_attempt_at": _now().isoformat()}},
        )
    return ok


async def process_digests() -> dict:
    """Main cron entrypoint. Returns a small stats dict for logging."""
    now = _now()
    rows = await db.notification_queue.find(
        {"channel": "email", "frequency": {"$in": ["daily", "weekly"]}, "sent_at": None},
        {"_id": 0},
    ).to_list(5000)

    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["principal_kind"], r["principal_id"], r["frequency"])].append(r)

    flushed = 0
    for (kind, pid, freq), items in groups.items():
        if await _should_flush(kind, pid, freq, now):  # type: ignore[arg-type]
            if await _send_digest_and_clear(kind, pid, freq, items):  # type: ignore[arg-type]
                flushed += 1
    stats = {"groups": len(groups), "flushed": flushed, "queued_rows": len(rows)}
    logger.info("Digest run: %s", stats)
    return stats
