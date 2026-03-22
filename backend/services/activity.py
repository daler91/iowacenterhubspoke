import uuid
from datetime import datetime, timezone
from database import db

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
