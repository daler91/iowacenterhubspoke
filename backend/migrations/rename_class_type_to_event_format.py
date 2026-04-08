"""One-time migration: Rename class_type field to event_format in projects and project_templates.

This resolves terminology confusion between the scheduling "Class" entity (e.g. Financial Literacy)
and the project delivery format (workshop, series, office_hours, onboarding).

Run with: python -m migrations.rename_class_type_to_event_format
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

    # Rename class_type -> event_format in projects
    result = await db.projects.update_many(
        {"class_type": {"$exists": True}},
        {"$rename": {"class_type": "event_format"}},
    )
    print(f"Projects updated: {result.modified_count}")

    # Rename class_type -> event_format in project_templates
    result = await db.project_templates.update_many(
        {"class_type": {"$exists": True}},
        {"$rename": {"class_type": "event_format"}},
    )
    print(f"Project templates updated: {result.modified_count}")

    client.close()
    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(migrate())
