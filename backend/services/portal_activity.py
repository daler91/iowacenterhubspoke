"""Partner-safe portal activity helpers.

Portal activity is intentionally separate from the internal admin activity log:
the portal can only show events scoped to one partner org and safe for external
contacts to read.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from core.logger import get_logger
from database import db

logger = get_logger(__name__)

DEFAULT_ACTIVITY_LIMIT = 20
MAX_ACTIVITY_LIMIT = 100


def _clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_ACTIVITY_LIMIT
    return max(1, min(limit, MAX_ACTIVITY_LIMIT))


async def log_portal_activity(
    *,
    partner_org_id: str | None,
    action: str,
    title: str,
    actor_name: str,
    actor_type: str,
    project_id: str | None = None,
    body: str = "",
    entity_type: str = "",
    entity_id: str = "",
) -> None:
    """Persist a partner-visible activity row.

    Activity is best-effort: mutation endpoints must not fail just because the
    timeline write failed. The caller still owns deciding whether an event is
    safe for partner visibility.
    """
    if not partner_org_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "partner_org_id": partner_org_id,
        "project_id": project_id,
        "action": action,
        "title": title,
        "body": body,
        "actor_name": actor_name or "System",
        "actor_type": actor_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "created_at": now,
    }
    try:
        await db.portal_activity_events.insert_one(doc)
    except Exception:
        logger.exception(
            "Failed to write portal activity",
            extra={
                "entity": {
                    "partner_org_id": partner_org_id,
                    "project_id": project_id,
                    "action": action,
                    "entity_id": entity_id,
                }
            },
        )


async def list_portal_activity(
    *,
    partner_org_id: str,
    project_id: Optional[str] = None,
    limit: int | None = None,
) -> list[dict]:
    query: dict = {"partner_org_id": partner_org_id}
    if project_id:
        query["project_id"] = project_id
    safe_limit = _clamp_limit(limit)
    cursor = (
        db.portal_activity_events.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(safe_limit)
    )
    return await cursor.to_list(safe_limit)
