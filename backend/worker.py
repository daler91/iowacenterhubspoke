import asyncio
import os
import logging
from arq.connections import RedisSettings
from dotenv import load_dotenv

from core.logger import setup_logging, get_logger

load_dotenv()
# Set up JSON structured logging
setup_logging()
logger = get_logger('Worker')

async def generate_bulk_schedules(ctx, data_dict: dict, dates_to_schedule: list, drive_time: int, recurrence_rule_dict: dict, location: dict, employee: dict, class_doc: dict, user_name: str):
    from models.schemas import ScheduleCreate, RecurrenceRule
    from database import db
    from services.schedule_utils import check_conflicts
    from routers.schedules import _check_town_to_town, _build_schedule_doc
    from services.activity import log_activity
    
    data = ScheduleCreate(**data_dict)
    recurrence_rule = RecurrenceRule(**recurrence_rule_dict) if recurrence_rule_dict else None
    
    created = []
    conflicts_found = []
    
    for sched_date in dates_to_schedule:
        conflicts = await check_conflicts(data.employee_id, sched_date, data.start_time, data.end_time, drive_time)
        if conflicts:
            conflicts_found.append({"date": sched_date, "conflicts": conflicts})
            continue

        town_to_town, town_to_town_warning = await _check_town_to_town(data.employee_id, sched_date, data.location_id)
        doc = _build_schedule_doc(data, sched_date, drive_time, town_to_town, town_to_town_warning, recurrence_rule, location, employee, class_doc)
        
        await db.schedules.insert_one(doc)
        doc.pop("_id", None)
        created.append(doc)
        
    if created:
        count_label = f"{len(created)} classes" if len(created) > 1 else "class"
        class_label = f" for {class_doc['name']}" if class_doc else ""
        await log_activity(
            action="schedule_created_bulk",
            description=f"{employee['name']} assigned to {location['city_name']}{class_label} — {count_label} starting {dates_to_schedule[0]} (Background Task)",
            entity_type="schedule",
            entity_id=created[0]['id'],
            user_name=user_name
        )
        
    logger.info(f"Bulk schedule generation completed. Created: {len(created)}, Skipped due to conflicts: {len(conflicts_found)}", extra={"entity": {"employee_id": data.employee_id, "created_count": len(created), "conflicts_count": len(conflicts_found)}})
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
                {"$set": {
                    "employee_name": employee["name"],
                    "employee_color": employee.get("color", "#4F46E5")
                }}
            )
    elif entity_type == "location":
        location = await db.locations.find_one({"id": entity_id}, {"_id": 0})
        if location:
            await db.schedules.update_many(
                {"location_id": entity_id},
                {"$set": {
                    "location_name": location["city_name"],
                    "drive_time_minutes": location["drive_time_minutes"]  # Note: travel_override_minutes in schedule takes precedence in router logic, but this syncs the base drive time
                }}
            )
    elif entity_type == "class":
        class_doc = await db.classes.find_one({"id": entity_id}, {"_id": 0})
        if class_doc:
            snapshot = get_class_snapshot(class_doc)
            await db.schedules.update_many(
                {"class_id": entity_id},
                {"$set": {
                    "class_name": snapshot["class_name"],
                    "class_color": snapshot["class_color"],
                    "class_description": snapshot["class_description"]
                }}
            )
    
    logger.info(f"Sync completed for {entity_type}: {entity_id}")

redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")

class WorkerSettings:
    functions = [generate_bulk_schedules, sync_schedules_denormalized]
    redis_settings = RedisSettings.from_dsn(redis_url)
