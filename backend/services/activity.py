import uuid
from datetime import datetime, timezone
from typing import Optional
from database import db

DELETED_USER_PLACEHOLDER = "Deleted user"


async def log_activity(
    action: str,
    description: str,
    entity_type: str,
    entity_id: str,
    user_name: str = "System",
    user_id: Optional[str] = None,
):
    doc = {
        "id": str(uuid.uuid4()),
        "action": action,
        "description": description,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_name": user_name,
        "user_id": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await db.activity_logs.insert_one(doc)


async def redact_user_from_activity(user_id: str, user_name: str) -> int:
    """Mask a deleted user's PII across historical activity logs.

    Matches by user_id (new rows) and by user_name (legacy rows without
    user_id). Over-matching on a shared name is intentional — privacy wins
    over audit-trail precision.
    """
    or_clauses = [{"user_id": user_id}]
    if user_name:
        or_clauses.append({"user_name": user_name, "user_id": None})
    result = await db.activity_logs.update_many(
        {"$or": or_clauses},
        {"$set": {"user_name": DELETED_USER_PLACEHOLDER, "user_id": None}},
    )
    return result.modified_count


async def hydrate_user_name(user_id: Optional[str], user_name: Optional[str]) -> str:
    """Return a display name for an activity-log row, honoring soft-deletes."""
    if not user_id:
        return user_name or DELETED_USER_PLACEHOLDER
    owner = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "deleted_at": 1, "name": 1}
    )
    if not owner or owner.get("deleted_at"):
        return DELETED_USER_PLACEHOLDER
    return owner.get("name") or user_name or DELETED_USER_PLACEHOLDER
