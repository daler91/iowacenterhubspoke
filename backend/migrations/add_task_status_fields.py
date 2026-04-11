"""One-time migration: Add status, spotlight, at_risk fields to existing tasks.

Existing tasks only have a boolean ``completed`` field. This migration adds:

- ``status`` — derived from ``completed`` (True → "completed", False → "to_do")
- ``spotlight`` — defaults to False
- ``at_risk`` — defaults to False

Run via the migration runner (``migrations.runner.run_pending``). For ad-hoc
execution against an arbitrary deployment use::

    python -m migrations.add_task_status_fields
"""

from core.logger import get_logger

logger = get_logger(__name__)


async def run(db) -> int:
    """Apply the migration against an existing database handle.

    Idempotent: only touches tasks missing the ``status`` field.
    """
    tasks = await db.tasks.find(
        {"status": {"$exists": False}},
        {"_id": 0, "id": 1, "completed": 1},
    ).to_list(50000)

    updated = 0
    for t in tasks:
        status = "completed" if t.get("completed") else "to_do"
        await db.tasks.update_one(
            {"id": t["id"]},
            {"$set": {"status": status, "spotlight": False, "at_risk": False}},
        )
        updated += 1

    logger.info("Migrated %d tasks (added status/spotlight/at_risk fields)", updated)
    return updated


if __name__ == "__main__":
    import asyncio
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv

    load_dotenv()
    _client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    _db = _client[os.environ.get("DB_NAME", "iowacenterhubspoke")]
    asyncio.run(run(_db))
    _client.close()
