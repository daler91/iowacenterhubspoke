"""One-time migration: Backfill class_id on projects from their linked schedules.

Projects created before this change have schedule_id but no class_id.
This migration copies the class_id from the linked schedule into each project.

Run with: python -m migrations.backfill_project_class_id
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

    # Find projects with schedule_id but no class_id
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

    print(f"Backfilled class_id on {updated} of {len(projects)} projects.")
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
