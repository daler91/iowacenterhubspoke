"""One-time migration: Add status, spotlight, at_risk fields to existing tasks.

Existing tasks only have a boolean `completed` field. This migration adds:
- status: derived from completed (True → "completed", False → "to_do")
- spotlight: defaults to False
- at_risk: defaults to False

Run with: python -m migrations.add_task_status_fields
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

    # Find tasks missing the status field
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

    print(f"Migrated {updated} tasks (added status/spotlight/at_risk fields).")
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
