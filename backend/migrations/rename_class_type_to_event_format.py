"""One-time migration: Rename class_type → event_format in projects and project_templates.

This resolves terminology confusion between the scheduling "Class" entity
(e.g. Financial Literacy) and the project delivery format (workshop, series,
office_hours, onboarding).

Run via the migration runner (``migrations.runner.run_pending``). For ad-hoc
execution against an arbitrary deployment use::

    python -m migrations.rename_class_type_to_event_format
"""

from core.logger import get_logger

logger = get_logger(__name__)


async def run(db) -> int:
    """Apply the migration against an existing database handle.

    Idempotent: only touches documents that still have the ``class_type``
    field. Returns the combined number of projects + templates updated.
    """
    projects_result = await db.projects.update_many(
        {"class_type": {"$exists": True}},
        {"$rename": {"class_type": "event_format"}},
    )
    templates_result = await db.project_templates.update_many(
        {"class_type": {"$exists": True}},
        {"$rename": {"class_type": "event_format"}},
    )
    total = projects_result.modified_count + templates_result.modified_count
    logger.info(
        "Renamed class_type → event_format on %d projects and %d templates",
        projects_result.modified_count,
        templates_result.modified_count,
    )
    return total


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
