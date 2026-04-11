"""One-time migration: Backfill class_id on projects from their linked schedules.

Projects created before this change have ``schedule_id`` but no ``class_id``.
This migration copies the ``class_id`` from the linked schedule into each
project.

Run via the migration runner (``migrations.runner.run_pending``). For ad-hoc
execution against an arbitrary deployment use::

    python -m migrations.backfill_project_class_id
"""

from core.logger import get_logger

logger = get_logger(__name__)


async def run(db) -> int:
    """Apply the migration against an existing database handle.

    Idempotent: only touches projects that have a ``schedule_id`` but no
    ``class_id`` set.
    """
    projects = await db.projects.find(
        {"schedule_id": {"$ne": None}, "class_id": None, "deleted_at": None},
        {"_id": 0, "id": 1, "schedule_id": 1},
    ).to_list(5000)

    updated = 0
    for p in projects:
        schedule = await db.schedules.find_one(
            {"id": p["schedule_id"]}, {"_id": 0, "class_id": 1}
        )
        if schedule and schedule.get("class_id"):
            await db.projects.update_one(
                {"id": p["id"]},
                {"$set": {"class_id": schedule["class_id"]}},
            )
            updated += 1

    logger.info("Backfilled class_id on %d of %d projects", updated, len(projects))
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
