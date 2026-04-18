import os
import uuid
from datetime import datetime, timezone, timedelta
from database import db
from core.logger import get_logger

logger = get_logger(__name__)

ACTIVITY_LOG_RETENTION_DAYS = int(os.environ.get("ACTIVITY_LOG_RETENTION_DAYS", "90"))


async def log_activity(
    action: str,
    description: str,
    entity_type: str,
    entity_id: str,
    user_name: str = "System",
    user_id: str | None = None,
):
    """Write one audit row.

    ``user_id`` is new and optional: legacy callers stay valid, but
    passing it lets the /auth/me anonymization filter on user_id
    instead of display name (two people sharing a name would otherwise
    over-match each other — a GDPR problem surfaced by ultrareview).
    """
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "action": action,
        "description": description,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_name": user_name,
        "user_id": user_id,
        "timestamp": now.isoformat(),
        # Native datetime is required for MongoDB TTL indexes — ISO string is ignored.
        "expires_at": now + timedelta(days=ACTIVITY_LOG_RETENTION_DAYS),
    }
    await db.activity_logs.insert_one(doc)
    logger.info(
        "Activity logged",
        extra={"entity": {"type": entity_type, "id": entity_id, "action": action}}
    )
