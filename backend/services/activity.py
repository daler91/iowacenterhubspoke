import uuid
from datetime import datetime, timezone
from database import db
from core.logger import get_logger

logger = get_logger(__name__)


async def log_activity(action: str, description: str, entity_type: str, entity_id: str, user_name: str = "System"):
    doc = {
        "id": str(uuid.uuid4()),
        "action": action,
        "description": description,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_name": user_name,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(doc)
    logger.info(
        "Activity logged",
        extra={"entity": {"type": entity_type, "id": entity_id, "action": action}}
    )
