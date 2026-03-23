import os
from arq.connections import RedisSettings
from dotenv import load_dotenv

from core.logger import setup_logging, get_logger

load_dotenv()
# Set up JSON structured logging
setup_logging()
logger = get_logger("Worker")


def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(":")
    return int(h) * 60 + int(m)


async def generate_bulk_schedules(
    ctx,
    data_dict: dict,
    dates_to_schedule: list,
    drive_time: int,
    recurrence_rule_dict: dict,
    location: dict,
    employee: dict,
    class_doc: dict,
    user_name: str,
):
    from models.schemas import ScheduleCreate, RecurrenceRule
    from database import db
    from routers.schedules import _build_schedule_doc
    from services.activity import log_activity

    data = ScheduleCreate(**data_dict)
    recurrence_rule = (
        RecurrenceRule(**recurrence_rule_dict)
        if recurrence_rule_dict
        else None
    )

    created = []
    conflicts_found = []

    # Pre-fetch existing schedules for the employee in the required date range
    if not dates_to_schedule:
        return {"created": 0, "conflicts": 0}

    min_date = min(dates_to_schedule)
    max_date = max(dates_to_schedule)

    existing_schedules = await db.schedules.find(
        {
            "employee_id": data.employee_id,
            "date": {"$gte": min_date, "$lte": max_date},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(None)

    # Group schedules by date for fast lookup
    schedules_by_date = {}
    for s in existing_schedules:
        schedules_by_date.setdefault(s["date"], []).append(s)

    # Pre-fetch locations for town-to-town checks
    location_ids = set()
    for s in existing_schedules:
        if s["location_id"] != data.location_id:
            location_ids.add(s["location_id"])

    other_locations = []
    if location_ids:
        other_locations = await db.locations.find(
            {"id": {"$in": list(location_ids)}}, {"_id": 0}
        ).to_list(None)
    loc_map = {loc["id"]: loc for loc in other_locations}

    docs_to_insert = []

    new_start = time_to_minutes(data.start_time) - drive_time
    new_end = time_to_minutes(data.end_time) + drive_time

    for sched_date in dates_to_schedule:
        day_schedules = schedules_by_date.get(sched_date, [])

        # Check conflicts in memory
        conflicts = []
        for s in day_schedules:
            s_drive = s.get("drive_time_minutes", 0)
            s_start = time_to_minutes(s["start_time"]) - s_drive
            s_end = time_to_minutes(s["end_time"]) + s_drive
            if new_start < s_end and new_end > s_start:
                conflicts.append(
                    {
                        "schedule_id": s["id"],
                        "location": s.get("location_name", "?"),
                        "time": f"{s['start_time']}-{s['end_time']}",
                        "overlap": f"Blocks overlap (inc {s_drive}m drive)",
                    }
                )

        if conflicts:
            conflicts_found.append(
                {"date": sched_date, "conflicts": conflicts}
            )
            continue

        # Check town-to-town in memory
        town_to_town = False
        town_to_town_warning = None

        other_day_locations = [
            s for s in day_schedules if s["location_id"] != data.location_id
        ]
        if other_day_locations:
            town_to_town = True
            other_cities = [
                loc_map[s["location_id"]]["city_name"]
                for s in other_day_locations
                if s["location_id"] in loc_map
            ]
            town_to_town_warning = (
                "Town-to-Town Travel Detected: Verify drive time "
                "manually. Other locations: " + ", ".join(other_cities)
            )

        doc = _build_schedule_doc(
            data,
            sched_date,
            drive_time,
            town_to_town,
            town_to_town_warning,
            recurrence_rule,
            location,
            employee,
            class_doc,
        )

        docs_to_insert.append(doc)

    if docs_to_insert:
        await db.schedules.insert_many(docs_to_insert)
        for doc in docs_to_insert:
            doc.pop("_id", None)
            created.append(doc)

    if created:
        count_label = (
            f"{len(created)} classes" if len(created) > 1 else "class"
        )
        class_label = f" for {class_doc['name']}" if class_doc else ""
        await log_activity(
            action="schedule_created_bulk",
            description=(
                f"{employee['name']} assigned to {location['city_name']}"
                f"{class_label}\n - {count_label} starting "
                f"{dates_to_schedule[0]} (Background Task)"
            ),
            entity_type="schedule",
            entity_id=created[0]["id"],
            user_name=user_name,
        )

    # Enqueue Outlook events for created schedules
    from core.outlook_config import OUTLOOK_ENABLED
    if OUTLOOK_ENABLED and employee.get('email'):
        for doc in created:
            try:
                pool = ctx.get('redis')
                if pool:
                    subject = f"{class_doc['name'] if class_doc else 'Class'} - {location['city_name']}"
                    await pool.enqueue_job(
                        "create_outlook_event",
                        schedule_id=doc['id'],
                        email=employee['email'],
                        subject=subject,
                        location_name=location['city_name'],
                        date=doc['date'],
                        start_time=doc['start_time'],
                        end_time=doc['end_time'],
                        notes=doc.get('notes', ''),
                    )
            except Exception:
                logger.exception("Failed to enqueue Outlook event for schedule %s", doc['id'])

    logger.info(
        f"Bulk sched generation completed. Created: {len(created)}, "
        f"Skipped due to conflicts: {len(conflicts_found)}",
        extra={
            "entity": {
                "employee_id": data.employee_id,
                "created_count": len(created),
                "conflicts_count": len(conflicts_found),
            }
        },
    )
    return {"created": len(created), "conflicts": len(conflicts_found)}


async def sync_schedules_denormalized(ctx, entity_type: str, entity_id: str):
    from database import db
    from routers.classes import get_class_snapshot

    logger.info(f"Syncing denormalized fields for {entity_type}: {entity_id}")

    if entity_type == "employee":
        employee = await db.employees.find_one({"id": entity_id}, {"_id": 0})
        if employee:
            await db.schedules.update_many(
                {"employee_id": entity_id},
                {
                    "$set": {
                        "employee_name": employee["name"],
                        "employee_color": employee.get("color", "#4F46E5"),
                    }
                },
            )
    elif entity_type == "location":
        location = await db.locations.find_one({"id": entity_id}, {"_id": 0})
        if location:
            await db.schedules.update_many(
                {"location_id": entity_id},
                {
                    "$set": {
                        "location_name": location["city_name"],
                        "drive_time_minutes": location["drive_time_minutes"],
                    }
                },
            )
    elif entity_type == "class":
        class_doc = await db.classes.find_one({"id": entity_id}, {"_id": 0})
        if class_doc:
            snapshot = get_class_snapshot(class_doc)
            await db.schedules.update_many(
                {"class_id": entity_id},
                {
                    "$set": {
                        "class_name": snapshot["class_name"],
                        "class_color": snapshot["class_color"],
                        "class_description": snapshot["class_description"],
                    }
                },
            )

    logger.info(f"Sync completed for {entity_type}: {entity_id}")


async def create_outlook_event(ctx, schedule_id: str, email: str, subject: str, location_name: str, date: str, start_time: str, end_time: str, notes: str = ""):
    from services.outlook import create_outlook_event as _create
    from database import db

    event_id = await _create(email, subject, location_name, date, start_time, end_time, notes or None)
    if event_id:
        await db.schedules.update_one({"id": schedule_id}, {"$set": {"outlook_event_id": event_id}})
        logger.info("Outlook event created for schedule %s: %s", schedule_id, event_id)
    else:
        logger.warning("Outlook event creation returned no ID for schedule %s", schedule_id)


async def delete_outlook_event(ctx, email: str, event_id: str):
    from services.outlook import delete_outlook_event as _delete

    success = await _delete(email, event_id)
    if success:
        logger.info("Outlook event %s deleted", event_id)
    else:
        logger.warning("Failed to delete Outlook event %s", event_id)


redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")


class WorkerSettings:
    functions = [generate_bulk_schedules, sync_schedules_denormalized, create_outlook_event, delete_outlook_event]
    redis_settings = RedisSettings.from_dsn(redis_url)
