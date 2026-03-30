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


def _check_day_conflicts(day_schedules, new_start, new_end):
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
    return conflicts


def _check_town_to_town(day_schedules, target_location_id, loc_map):
    other_day_locations = [
        s for s in day_schedules if s["location_id"] != target_location_id
    ]
    if not other_day_locations:
        return False, None
    other_cities = [
        loc_map[s["location_id"]]["city_name"]
        for s in other_day_locations
        if s["location_id"] in loc_map
    ]
    warning = (
        "Town-to-Town Travel Detected: Verify drive time "
        "manually. Other locations: " + ", ".join(other_cities)
    )
    return True, warning


async def _prefetch_schedule_data(db, data, dates_to_schedule):
    min_date = min(dates_to_schedule)
    max_date = max(dates_to_schedule)

    existing_schedules = await db.schedules.find(
        {
            "employee_id": data.employee_id,
            "date": {"$gte": min_date, "$lte": max_date},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(10000)

    schedules_by_date = {}
    for s in existing_schedules:
        schedules_by_date.setdefault(s["date"], []).append(s)

    location_ids = {
        s["location_id"]
        for s in existing_schedules
        if s["location_id"] != data.location_id
    }

    other_locations = []
    if location_ids:
        other_locations = await db.locations.find(
            {"id": {"$in": list(location_ids)}}, {"_id": 0}
        ).to_list(10000)
    loc_map = {loc["id"]: loc for loc in other_locations}

    return schedules_by_date, loc_map


async def _enqueue_outlook_events(ctx, created, employee, class_doc, location):
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    if not OUTLOOK_CALENDAR_ENABLED or not employee.get('outlook_calendar_connected'):
        return
    outlook_email = employee.get('outlook_calendar_email') or employee['email']
    from database import db as _db
    from services.outlook import create_outlook_event as _create
    city = location['city_name']
    class_name = class_doc['name'] if class_doc else 'Class'
    subject = f"{class_name} - {city}"
    for doc in created:
        try:
            event_ids = []
            drive_to = (
                doc.get("drive_to_override_minutes")
                or doc.get("drive_time_minutes") or 0
            )
            drive_from = (
                doc.get("drive_from_override_minutes")
                or doc.get("drive_time_minutes") or 0
            )

            if drive_to > 0:
                dt_start = _subtract_minutes(doc['start_time'], drive_to)
                eid = await _create(
                    outlook_email,
                    f"Drive to {city} ({drive_to} min)",
                    city, doc['date'], dt_start, doc['start_time'],
                    None, employee=employee,
                )
                if eid:
                    event_ids.append(eid)

            eid = await _create(
                outlook_email, subject, city,
                doc['date'], doc['start_time'], doc['end_time'],
                doc.get('notes') or None, employee=employee,
            )
            if eid:
                event_ids.append(eid)

            if drive_from > 0:
                df_end = _add_minutes(doc['end_time'], drive_from)
                eid = await _create(
                    outlook_email,
                    f"Drive from {city} ({drive_from} min)",
                    city, doc['date'], doc['end_time'], df_end,
                    None, employee=employee,
                )
                if eid:
                    event_ids.append(eid)

            if event_ids:
                update = {"outlook_event_id": event_ids[0]}
                if len(event_ids) > 1:
                    update["outlook_event_ids"] = event_ids
                await _db.schedules.update_one(
                    {"id": doc['id']}, {"$set": update}
                )
        except Exception:
            logger.exception(
                "Failed to create Outlook events for schedule %s",
                doc['id'],
            )


def _add_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _subtract_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = max(0, h * 60 + m - minutes)
    return f"{total // 60:02d}:{total % 60:02d}"


async def _enqueue_google_events(ctx, created, employee, class_doc, location):
    from core.google_config import GOOGLE_CALENDAR_ENABLED
    if not GOOGLE_CALENDAR_ENABLED or not employee.get('google_calendar_connected'):
        return
    google_email = employee.get('google_calendar_email') or employee['email']
    from database import db as _db
    from services.google_calendar import create_google_event as _create
    city = location['city_name']
    class_name = class_doc['name'] if class_doc else 'Class'
    subject = f"{class_name} - {city}"
    for doc in created:
        try:
            event_ids = []
            drive_to = (
                doc.get("drive_to_override_minutes")
                or doc.get("drive_time_minutes") or 0
            )
            drive_from = (
                doc.get("drive_from_override_minutes")
                or doc.get("drive_time_minutes") or 0
            )

            # Drive TO event
            if drive_to > 0:
                dt_start = _subtract_minutes(doc['start_time'], drive_to)
                eid = await _create(
                    google_email,
                    f"Drive to {city} ({drive_to} min)",
                    city, doc['date'], dt_start, doc['start_time'],
                    None, employee=employee,
                )
                if eid:
                    event_ids.append(eid)

            # Main class event
            eid = await _create(
                google_email, subject, city,
                doc['date'], doc['start_time'], doc['end_time'],
                doc.get('notes') or None, employee=employee,
            )
            if eid:
                event_ids.append(eid)

            # Drive FROM event
            if drive_from > 0:
                df_end = _add_minutes(doc['end_time'], drive_from)
                eid = await _create(
                    google_email,
                    f"Drive from {city} ({drive_from} min)",
                    city, doc['date'], doc['end_time'], df_end,
                    None, employee=employee,
                )
                if eid:
                    event_ids.append(eid)

            if event_ids:
                update = {"google_calendar_event_id": event_ids[0]}
                if len(event_ids) > 1:
                    update["google_calendar_event_ids"] = event_ids
                await _db.schedules.update_one(
                    {"id": doc['id']}, {"$set": update}
                )
        except Exception:
            logger.exception(
                "Failed to create Google Calendar events for schedule %s",
                doc['id'],
            )


async def _log_bulk_creation(log_activity, created, employee, location, class_doc, dates_to_schedule, user_name):
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
    from routers.schedule_helpers import _build_schedule_doc
    from services.activity import log_activity

    data = ScheduleCreate(**data_dict)
    recurrence_rule = (
        RecurrenceRule(**recurrence_rule_dict)
        if recurrence_rule_dict
        else None
    )

    if not dates_to_schedule:
        return {"created": 0, "conflicts": 0}

    schedules_by_date, loc_map = await _prefetch_schedule_data(db, data, dates_to_schedule)

    docs_to_insert = []
    conflicts_found = []
    new_start = time_to_minutes(data.start_time) - drive_time
    new_end = time_to_minutes(data.end_time) + drive_time

    for sched_date in dates_to_schedule:
        day_schedules = schedules_by_date.get(sched_date, [])
        conflicts = _check_day_conflicts(day_schedules, new_start, new_end)
        if conflicts:
            conflicts_found.append({"date": sched_date, "conflicts": conflicts})
            continue

        town_to_town, town_to_town_warning = _check_town_to_town(day_schedules, data.location_id, loc_map)
        doc = _build_schedule_doc(
            data, sched_date, drive_time, town_to_town, town_to_town_warning,
            recurrence_rule, location, employee, class_doc,
        )
        docs_to_insert.append(doc)

    created = []
    if docs_to_insert:
        await db.schedules.insert_many(docs_to_insert)
        for doc in docs_to_insert:
            doc.pop("_id", None)
            created.append(doc)

    if created:
        await _log_bulk_creation(log_activity, created, employee, location, class_doc, dates_to_schedule, user_name)

    await _enqueue_outlook_events(ctx, created, employee, class_doc, location)
    await _enqueue_google_events(ctx, created, employee, class_doc, location)

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

    logger.info("Syncing denormalized fields", extra={"entity": {"type": entity_type, "id": entity_id}})

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

    logger.info("Sync completed", extra={"entity": {"type": entity_type, "id": entity_id}})


async def create_outlook_event(
    ctx, schedule_id: str, email: str, subject: str, location_name: str,
    date: str, start_time: str, end_time: str, notes: str = "",
    employee_id: str = "",
):
    from services.outlook import create_outlook_event as _create
    from database import db

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    event_id = await _create(
        email, subject, location_name, date, start_time, end_time,
        notes or None, employee=employee,
    )
    if event_id:
        await db.schedules.update_one({"id": schedule_id}, {"$set": {"outlook_event_id": event_id}})
        logger.info("Outlook event created for schedule %s: %s", schedule_id, event_id)
    else:
        logger.warning("Outlook event creation returned no ID for schedule %s", schedule_id)


async def delete_outlook_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from services.outlook import delete_outlook_event as _delete
    from database import db

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    success = await _delete(email, event_id, employee=employee)
    if success:
        logger.info("Outlook event %s deleted", event_id)
    else:
        logger.warning("Failed to delete Outlook event %s", event_id)


async def create_google_event(
    ctx, schedule_id: str, email: str, subject: str, location_name: str,
    date: str, start_time: str, end_time: str, notes: str = "",
    employee_id: str = "",
):
    from services.google_calendar import create_google_event as _create
    from database import db

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    event_id = await _create(
        email, subject, location_name, date, start_time, end_time,
        notes or None, employee=employee,
    )
    if event_id:
        await db.schedules.update_one({"id": schedule_id}, {"$set": {"google_calendar_event_id": event_id}})
        logger.info("Google Calendar event created for schedule %s: %s", schedule_id, event_id)
    else:
        logger.warning("Google Calendar event creation returned no ID for schedule %s", schedule_id)


async def delete_google_event(ctx, email: str, event_id: str, employee_id: str = ""):
    from services.google_calendar import delete_google_event as _delete
    from database import db

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    success = await _delete(email, event_id, employee=employee)
    if success:
        logger.info("Google Calendar event %s deleted", event_id)
    else:
        logger.warning("Failed to delete Google Calendar event %s", event_id)


from core.constants import DEFAULT_REDIS_URL  # noqa: E402

redis_url = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)


class WorkerSettings:
    functions = [
        generate_bulk_schedules, sync_schedules_denormalized,
        create_outlook_event, delete_outlook_event,
        create_google_event, delete_google_event,
    ]
    redis_settings = RedisSettings.from_dsn(redis_url)
