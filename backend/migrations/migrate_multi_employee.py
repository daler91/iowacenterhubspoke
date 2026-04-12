"""One-time migration: Convert schedule documents from single-employee to multi-employee model.

Converts:
  employee_id -> employee_ids: [employee_id]
  employee_name, employee_color -> employees: [{id, name, color}]
  outlook_event_id, google_calendar_event_id(s) -> calendar_events: {employee_id: {...}}

Run via the migration runner (``migrations.runner.run_pending``). For ad-hoc
execution against an arbitrary deployment use::

    python -m migrations.migrate_multi_employee
"""

from core.logger import get_logger

logger = get_logger(__name__)


async def run(db) -> int:
    """Apply the migration against an existing database handle.

    Idempotent: only touches schedules that still have the legacy
    ``employee_id`` field and no ``employee_ids`` array.
    """
    cursor = db.schedules.find(
        {"employee_id": {"$exists": True}, "employee_ids": {"$exists": False}},
        {"_id": 0},
    )

    count = 0
    async for schedule in cursor:
        emp_id = schedule.get("employee_id")
        emp_name = schedule.get("employee_name", "Unknown")
        emp_color = schedule.get("employee_color", "#4F46E5")

        if not emp_id:
            continue

        calendar_events = {}
        outlook_eid = schedule.get("outlook_event_id")
        google_eid = schedule.get("google_calendar_event_id")
        google_eids = schedule.get("google_calendar_event_ids")

        if outlook_eid or google_eid or google_eids:
            cal_entry = {}
            if outlook_eid:
                cal_entry["outlook_event_id"] = outlook_eid
            if google_eid:
                cal_entry["google_calendar_event_id"] = google_eid
            if google_eids:
                cal_entry["google_calendar_event_ids"] = google_eids
            calendar_events[emp_id] = cal_entry

        update = {
            "$set": {
                "employee_ids": [emp_id],
                "employees": [
                    {"id": emp_id, "name": emp_name, "color": emp_color}
                ],
                "calendar_events": calendar_events,
            },
        }

        await db.schedules.update_one(
            {"id": schedule["id"]}, update
        )
        count += 1

    logger.info("Migrated %d schedule documents to multi-employee model", count)
    # Index creation is owned by ``server._ensure_indexes`` (see
    # ``backend/server.py``), which creates the same ``employee_ids`` key
    # patterns on every boot. Re-creating them here with explicit names
    # triggers ``IndexOptionsConflict`` against deployments whose auto-named
    # indexes were created before the migration runner existed, which would
    # crash the FastAPI lifespan and permanently wedge the deploy.
    return count


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
