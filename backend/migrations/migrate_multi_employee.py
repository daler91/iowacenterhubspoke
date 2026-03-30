"""One-time migration: Convert schedule documents from single-employee to multi-employee model.

Converts:
  employee_id -> employee_ids: [employee_id]
  employee_name, employee_color -> employees: [{id, name, color}]
  outlook_event_id, google_calendar_event_id(s) -> calendar_events: {employee_id: {...}}

Run with: python -m migrations.migrate_multi_employee
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "iowacenterhubspoke")


async def migrate():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Find all schedules that still have the old employee_id field
    # but don't yet have employee_ids
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

        # Build calendar_events from legacy fields
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

    print(f"Migrated {count} schedule documents to multi-employee model.")

    # Create new index
    await db.schedules.create_index(
        [("employee_ids", 1), ("date", 1)],
        name="employee_ids_date",
    )
    await db.schedules.create_index(
        [("employee_ids", 1), ("date", 1), ("deleted_at", 1)],
        name="employee_ids_date_deleted",
    )
    print("Created employee_ids indexes.")

    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
