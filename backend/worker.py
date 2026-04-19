import os
import arq
from arq.connections import RedisSettings
from dotenv import load_dotenv

from core.logger import setup_logging, get_logger
from core.constants import QUERY_LIMIT

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

    # Use the first employee for conflict prefetch
    first_employee_id = data.employee_ids[0] if data.employee_ids else None
    if not first_employee_id:
        return {}, {}

    existing_schedules = await db.schedules.find(
        {
            "employee_ids": first_employee_id,
            "date": {"$gte": min_date, "$lte": max_date},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(QUERY_LIMIT)

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
        ).to_list(QUERY_LIMIT)
    loc_map = {loc["id"]: loc for loc in other_locations}

    return schedules_by_date, loc_map


async def _enqueue_outlook_events(ctx, created, employees, class_doc, location):
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    if not OUTLOOK_CALENDAR_ENABLED:
        return
    for employee in employees:
        if not employee.get('email'):
            continue
        for doc in created:
            try:
                pool = ctx.get('redis')
                if not pool:
                    continue
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
                    employee_id=employee['id'],
                )
            except (OSError, RuntimeError) as exc:
                logger.exception("Failed to enqueue Outlook event for schedule %s: %s", doc['id'], exc)


def _add_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _subtract_minutes(time_str: str, minutes: int) -> str:
    h, m = map(int, time_str.split(":"))
    total = max(0, h * 60 + m - minutes)
    return f"{total // 60:02d}:{total % 60:02d}"


async def _create_google_events_for_doc(employee, doc, city, subject):
    """Create drive-to, class, and drive-from Google Calendar events for one schedule doc."""
    from database import db as _db
    from services.google_calendar import create_google_event as _create

    google_email = employee.get('google_calendar_email') or employee['email']
    event_ids = []
    drive_to = doc.get("drive_to_override_minutes") or doc.get("drive_time_minutes") or 0
    drive_from = doc.get("drive_from_override_minutes") or doc.get("drive_time_minutes") or 0

    if drive_to > 0:
        dt_start = _subtract_minutes(doc['start_time'], drive_to)
        eid = await _create(
            google_email, f"Drive to {city} ({drive_to} min)",
            city, doc['date'], dt_start, doc['start_time'], None, employee=employee,
        )
        if eid:
            event_ids.append(eid)

    eid = await _create(
        google_email, subject, city,
        doc['date'], doc['start_time'], doc['end_time'],
        doc.get('notes') or None, employee=employee,
    )
    if eid:
        event_ids.append(eid)

    if drive_from > 0:
        df_end = _add_minutes(doc['end_time'], drive_from)
        eid = await _create(
            google_email, f"Drive from {city} ({drive_from} min)",
            city, doc['date'], doc['end_time'], df_end, None, employee=employee,
        )
        if eid:
            event_ids.append(eid)

    if event_ids:
        cal_data = {
            "google_calendar_event_id": event_ids[0],
            "google_calendar_event_ids": event_ids,
        }
        await _db.schedules.update_one(
            {"id": doc['id']},
            {"$set": {f"calendar_events.{employee['id']}": cal_data}},
        )


async def _enqueue_google_events(created, employees, class_doc, location):
    from core.google_config import GOOGLE_CALENDAR_ENABLED
    if not GOOGLE_CALENDAR_ENABLED:
        return
    city = location['city_name']
    class_name = class_doc['name'] if class_doc else 'Class'
    subject = f"{class_name} - {city}"
    for employee in employees:
        if not employee.get('google_calendar_connected'):
            continue
        for doc in created:
            try:
                await _create_google_events_for_doc(employee, doc, city, subject)
            except Exception:
                logger.exception(
                    "Failed to create Google Calendar events for schedule %s",
                    doc['id'],
                )


async def _log_bulk_creation(log_activity, created, employees, location, class_doc, dates_to_schedule, user_name):
    count_label = (
        f"{len(created)} classes" if len(created) > 1 else "class"
    )
    class_label = f" for {class_doc['name']}" if class_doc else ""
    emp_names = ", ".join(e["name"] for e in employees)
    await log_activity(
        action="schedule_created_bulk",
        description=(
            f"{emp_names} assigned to {location['city_name']}"
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
    employees: list,
    class_doc: dict,
    user_name: str,
    series_id: str = None,
    created_by_user_id: str = None,
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
            recurrence_rule, location, employees, class_doc,
            series_id=series_id,
            created_by_user_id=created_by_user_id,
        )
        docs_to_insert.append(doc)

    created = []
    if docs_to_insert:
        await db.schedules.insert_many(docs_to_insert)
        for doc in docs_to_insert:
            doc.pop("_id", None)
            created.append(doc)

    if created:
        await _log_bulk_creation(log_activity, created, employees, location, class_doc, dates_to_schedule, user_name)

    await _enqueue_outlook_events(ctx, created, employees, class_doc, location)
    await _enqueue_google_events(created, employees, class_doc, location)

    # The router that enqueued this job already invalidated the workload
    # cache, but that happened BEFORE insert_many ran. Any /workload read
    # landing in that gap would cache pre-insert totals for a full TTL.
    # Bust again here so the next read recomputes from the rows we just
    # wrote. Skipped if no rows were inserted (all conflicts).
    if created:
        redis_pool = ctx.get("redis")
        if redis_pool is not None:
            try:
                from services.workload_cache import CACHE_KEY as _WORKLOAD_CACHE_KEY
                await redis_pool.delete(_WORKLOAD_CACHE_KEY)
            except Exception:
                logger.warning(
                    "workload cache invalidate failed after bulk insert",
                    exc_info=True,
                    extra={"entity": {"created_count": len(created)}},
                )

    logger.info(
        f"Bulk sched generation completed. Created: {len(created)}, "
        f"Skipped due to conflicts: {len(conflicts_found)}",
        extra={
            "entity": {
                "employee_ids": data.employee_ids,
                "created_count": len(created),
                "conflicts_count": len(conflicts_found),
            }
        },
    )
    return {"created": len(created), "conflicts": len(conflicts_found)}


async def sync_schedules_denormalized(ctx, entity_type: str, entity_id: str):
    from database import db
    from datetime import datetime as _dt, timezone as _tz
    from routers.classes import get_class_snapshot

    logger.info("Syncing denormalized fields", extra={"entity": {"type": entity_type, "id": entity_id}})
    today_str = _dt.now(_tz.utc).strftime("%Y-%m-%d")

    if entity_type == "employee":
        employee = await db.employees.find_one({"id": entity_id}, {"_id": 0})
        if employee:
            # Only update future schedules to preserve historical accuracy
            await db.schedules.update_many(
                {"employee_ids": entity_id, "date": {"$gte": today_str}},
                {
                    "$set": {
                        "employees.$[elem].name": employee["name"],
                        "employees.$[elem].color": employee.get("color", "#4F46E5"),
                    }
                },
                array_filters=[{"elem.id": entity_id}],
            )
    elif entity_type == "location":
        location = await db.locations.find_one({"id": entity_id}, {"_id": 0})
        if location:
            # Only update future schedules to preserve historical accuracy
            await db.schedules.update_many(
                {"location_id": entity_id, "date": {"$gte": today_str}},
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

    # The router that enqueued this job already invalidated the workload
    # cache synchronously, but that happened BEFORE the denormalized
    # snapshots on the schedule rows were rewritten. Without this second
    # invalidation, a /workload request landing between the router flush
    # and this job's completion would recompute from pre-sync data and
    # cache those stale values for a full TTL. Busting the key again here
    # closes that window — the next request recomputes from the fresh
    # denormalized snapshots.
    redis_pool = ctx.get("redis")
    if redis_pool is not None:
        try:
            from services.workload_cache import CACHE_KEY as _WORKLOAD_CACHE_KEY
            await redis_pool.delete(_WORKLOAD_CACHE_KEY)
        except Exception:
            logger.warning(
                "workload cache invalidate failed after sync",
                exc_info=True,
                extra={"entity": {"type": entity_type, "id": entity_id}},
            )

    logger.info("Sync completed", extra={"entity": {"type": entity_type, "id": entity_id}})


async def create_outlook_event(
    ctx, schedule_id: str, email: str, subject: str, location_name: str,
    date: str, start_time: str, end_time: str, notes: str = "",
    employee_id: str = "",
):
    """Idempotent create — if arq retries after a partial failure, we won't
    create a duplicate event for a schedule that already has one mapped."""
    from services.outlook import create_outlook_event as _create
    from database import db

    # Short-circuit if a previous attempt already persisted a mapping for
    # this (schedule_id, employee_id). Otherwise a retry after a pool
    # timeout between calendar-create and DB-update would double-book.
    existing = await db.schedules.find_one(
        {"id": schedule_id}, {"_id": 0, "calendar_events": 1, "outlook_event_id": 1},
    )
    if existing:
        if employee_id:
            mapped = (
                (existing.get("calendar_events") or {})
                .get(employee_id, {})
                .get("outlook_event_id")
            )
        else:
            mapped = existing.get("outlook_event_id")
        if mapped:
            # Mask IDs — CodeQL flags raw UUID interpolation even on
            # internal identifiers. The mask still gives ops a 4/4
            # correlation key for cross-service log-joining.
            from core.logger import mask_id
            logger.info(
                "Outlook event already mapped; skipping create",
                extra={"entity": {
                    "schedule_id_masked": mask_id(schedule_id),
                    "employee_scoped": bool(employee_id),
                }},
            )
            return

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    event_id = await _create(
        email, subject, location_name, date, start_time, end_time,
        notes or None, employee=employee,
    )
    if event_id:
        update_key = f"calendar_events.{employee_id}.outlook_event_id" if employee_id else "outlook_event_id"
        await db.schedules.update_one({"id": schedule_id}, {"$set": {update_key: event_id}})
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
    """Idempotent create — see ``create_outlook_event`` for the rationale."""
    from services.google_calendar import create_google_event as _create
    from database import db

    existing = await db.schedules.find_one(
        {"id": schedule_id}, {"_id": 0, "calendar_events": 1, "google_calendar_event_id": 1},
    )
    if existing:
        if employee_id:
            mapped = (
                (existing.get("calendar_events") or {})
                .get(employee_id, {})
                .get("google_calendar_event_id")
            )
        else:
            mapped = existing.get("google_calendar_event_id")
        if mapped:
            from core.logger import mask_id
            logger.info(
                "Google event already mapped; skipping create",
                extra={"entity": {
                    "schedule_id_masked": mask_id(schedule_id),
                    "employee_scoped": bool(employee_id),
                }},
            )
            return

    employee = None
    if employee_id:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    event_id = await _create(
        email, subject, location_name, date, start_time, end_time,
        notes or None, employee=employee,
    )
    if event_id:
        if employee_id:
            update_key = f"calendar_events.{employee_id}.google_calendar_event_id"
        else:
            update_key = "google_calendar_event_id"
        await db.schedules.update_one({"id": schedule_id}, {"$set": {update_key: event_id}})
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


async def process_task_reminders(ctx):
    """Cron job: check for tasks approaching/past due and send reminders."""
    from services.task_reminders import check_and_send_reminders
    return await check_and_send_reminders()


async def process_notification_digests(ctx):
    """Cron job: flush queued daily/weekly notification digests.

    Runs every hour. The digest service only sends to principals whose
    configured ``digest.daily_hour`` / ``digest.weekly_day`` matches now,
    so the hour-granularity cadence is the natural choice.
    """
    from services.digest import process_digests
    return await process_digests()


async def deliver_webhook_job(ctx, subscription_id, event, payload):
    """Background job: deliver a webhook to a subscriber."""
    from services.webhooks import deliver_webhook
    return await deliver_webhook(ctx, subscription_id, event, payload)


async def send_password_reset_email_job(ctx, email):
    """Background job: send a password reset email (anti-enumeration safe).

    The handler enqueues unconditionally; this worker is where the DB
    lookup and SMTP send happen, off the request path.
    """
    from services.email_jobs import send_password_reset_email
    return await send_password_reset_email(email)


async def send_partner_magic_link_email_job(ctx, email):
    """Background job: send a partner portal magic link email.

    Same pattern as send_password_reset_email_job — the handler enqueues
    unconditionally and returns immediately; this worker does the DB
    lookup and SMTP send.
    """
    from services.email_jobs import send_partner_magic_link_email
    return await send_partner_magic_link_email(email)


WORKER_HEARTBEAT_KEY = "arq:heartbeat"
# Key TTL set deliberately higher than the cron cadence so a single missed
# tick doesn't flip the liveness signal, but short enough that a truly
# dead worker is detected within ~2 minutes.
WORKER_HEARTBEAT_TTL_SECONDS = 120


async def emit_worker_heartbeat(ctx) -> None:
    """Cron job: stamp a Redis key so ``/health`` can tell whether a worker
    is live. Without this, dead workers look healthy — jobs enqueue fine
    into Redis but no process picks them up.
    """
    from datetime import datetime, timezone
    redis_pool = ctx.get("redis")
    if redis_pool is None:
        return
    await redis_pool.set(
        WORKER_HEARTBEAT_KEY,
        datetime.now(timezone.utc).isoformat(),
        ex=WORKER_HEARTBEAT_TTL_SECONDS,
    )


class WorkerSettings:
    functions = [
        generate_bulk_schedules, sync_schedules_denormalized,
        create_outlook_event, delete_outlook_event,
        create_google_event, delete_google_event,
        deliver_webhook_job,
        send_password_reset_email_job,
        send_partner_magic_link_email_job,
    ]
    cron_jobs = [
        arq.cron(process_task_reminders, hour=None, minute=0),
        arq.cron(process_notification_digests, hour=None, minute=5),
        # Heartbeat every minute; /health flags "degraded" if the key is
        # missing or older than 90s.
        arq.cron(emit_worker_heartbeat, hour=None, minute=None),
    ]
    redis_settings = RedisSettings.from_dsn(redis_url)
    # Retry each failed job up to 3 times with arq's built-in exponential
    # backoff. Without this the default is 5 retries, but with no backoff
    # tuning — surfacing the explicit value keeps the policy reviewable.
    max_tries = 3
    # Drop job results from Redis after a day — keeps memory bounded while
    # still allowing recent results to be fetched via ``Job.result()``.
    keep_result = 86400
