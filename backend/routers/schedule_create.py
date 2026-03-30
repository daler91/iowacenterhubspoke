"""Schedule creation: single and recurring (bulk) schedule creation."""

import uuid
from fastapi import HTTPException

from database import db
from models.schemas import ScheduleCreate
from core.auth import SchedulerRequired
from services.activity import log_activity
from services.schedule_utils import (
    build_recurrence_rule,
    build_recurrence_dates,
    check_conflicts,
    check_outlook_conflicts,
    check_google_conflicts,
)
from routers.schedule_helpers import (
    logger,
    _build_schedule_doc,
    _fetch_schedule_entities,
    _check_town_to_town,
    _check_town_to_town_bulk,
    _sync_same_day_town_to_town,
    _enqueue_calendar_events_for_all,
)


async def _handle_single_schedule(
    data: ScheduleCreate,
    date_to_schedule: str,
    drive_time: int,
    recurrence_rule,
    location: dict,
    employees: list[dict],
    class_doc: dict | None,
    user: SchedulerRequired,
):
    # Check conflicts for each employee
    per_employee_conflicts = {}
    for emp in employees:
        conflicts = await check_conflicts(
            emp["id"],
            date_to_schedule,
            data.start_time,
            data.end_time,
            drive_time,
        )
        if conflicts:
            per_employee_conflicts[emp["id"]] = {
                "name": emp["name"],
                "conflicts": conflicts,
            }

    if per_employee_conflicts and not data.force:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Schedule conflict detected",
                "conflicts": [],
                "per_employee_conflicts": per_employee_conflicts,
            },
        )

    # Check Outlook/Google conflicts for first employee (primary)
    primary = employees[0]
    if not data.force_outlook:
        outlook_conflicts = await check_outlook_conflicts(
            primary["id"], date_to_schedule, data.start_time, data.end_time
        )
        if outlook_conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Outlook calendar conflict detected",
                    "conflicts": [],
                    "outlook_conflicts": outlook_conflicts,
                },
            )

    if not data.force_google:
        google_conflicts = await check_google_conflicts(
            primary["id"], date_to_schedule, data.start_time, data.end_time
        )
        if google_conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Google Calendar conflict detected",
                    "conflicts": [],
                    "google_conflicts": google_conflicts,
                },
            )

    # Check town-to-town for first employee
    town_to_town, town_to_town_warning, town_to_town_drive_minutes = (
        await _check_town_to_town(primary["id"], date_to_schedule, data.location_id)
    )

    doc = _build_schedule_doc(
        data,
        date_to_schedule,
        drive_time,
        town_to_town,
        town_to_town_warning,
        recurrence_rule,
        location,
        employees,
        class_doc,
        town_to_town_drive_minutes=town_to_town_drive_minutes,
    )
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)

    # Create calendar events for all employees
    _enqueue_calendar_events_for_all(employees, location, class_doc, doc)

    logger.info(
        "Schedule created",
        extra={
            "entity": {
                "schedule_id": doc["id"],
                "employee_ids": data.employee_ids,
                "location_id": data.location_id,
            }
        },
    )

    for emp in employees:
        await _sync_same_day_town_to_town(emp["id"], date_to_schedule)

    emp_names = ", ".join(e["name"] for e in employees)
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created",
        description=(
            f"{emp_names} assigned to {location['city_name']}"
            f"{class_label} — 1 class starting {data.date}"
        ),
        entity_type="schedule",
        entity_id=doc["id"],
        user_name=user.get("name", "System"),
    )
    return doc


async def _handle_bulk_background(
    data: ScheduleCreate,
    dates_to_schedule: list[str],
    drive_time: int,
    recurrence_rule,
    location: dict,
    employees: list[dict],
    class_doc: dict | None,
    user: SchedulerRequired,
):
    from core.queue import get_redis_pool

    pool = await get_redis_pool()
    if not pool:
        return None

    recurrence_dict = recurrence_rule.model_dump() if recurrence_rule else None

    await pool.enqueue_job(
        "generate_bulk_schedules",
        data_dict=data.model_dump(),
        dates_to_schedule=dates_to_schedule,
        drive_time=drive_time,
        recurrence_rule_dict=recurrence_dict,
        location=location,
        employees=employees,
        class_doc=class_doc,
        user_name=user.get("name", "System"),
    )
    logger.info(
        "Bulk schedules enqueued",
        extra={
            "entity": {
                "employee_ids": data.employee_ids,
                "location_id": data.location_id,
                "dates_count": len(dates_to_schedule),
            }
        },
    )

    emp_names = ", ".join(e["name"] for e in employees)
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created_bulk_enqueued",
        description=(
            f"Bulk schedule pipeline queued for {emp_names} at "
            f"{location['city_name']}{class_label} ({len(dates_to_schedule)} dates)"
        ),
        entity_type="schedule_batch",
        entity_id=str(uuid.uuid4()),
        user_name=user.get("name", "System"),
    )
    return {
        "message": "Bulk schedule generation is running in the background.",
        "total_created": len(dates_to_schedule),
        "background": True,
    }


async def _handle_bulk_synchronous(
    data: ScheduleCreate,
    dates_to_schedule: list[str],
    drive_time: int,
    recurrence_rule,
    location: dict,
    employees: list[dict],
    class_doc: dict | None,
    user: SchedulerRequired,
):
    from services.schedule_utils import check_conflicts_bulk

    created = []
    conflicts_found = []

    # Check conflicts for first employee (primary) for bulk
    primary = employees[0]
    all_conflicts = await check_conflicts_bulk(
        primary["id"],
        dates_to_schedule,
        data.start_time,
        data.end_time,
        drive_time,
    )

    all_town_warnings = await _check_town_to_town_bulk(
        primary["id"], dates_to_schedule, data.location_id
    )

    docs_to_insert = []

    for sched_date in dates_to_schedule:
        conflicts = all_conflicts.get(sched_date, [])
        if conflicts:
            conflicts_found.append(
                {"date": sched_date, "conflicts": conflicts}
            )
            continue

        town_to_town, town_to_town_warning, tt_drive_minutes = all_town_warnings.get(
            sched_date, (False, None, None)
        )

        doc = _build_schedule_doc(
            data,
            sched_date,
            drive_time,
            town_to_town,
            town_to_town_warning,
            recurrence_rule,
            location,
            employees,
            class_doc,
            town_to_town_drive_minutes=tt_drive_minutes,
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
        emp_names = ", ".join(e["name"] for e in employees)
        class_label = f" for {class_doc['name']}" if class_doc else ""
        await log_activity(
            action="schedule_created",
            description=(
                f"{emp_names} assigned to {location['city_name']}"
                f"{class_label} — {count_label} starting {data.date}"
            ),
            entity_type="schedule",
            entity_id=created[0]["id"],
            user_name=user.get("name", "System"),
        )
    return {
        "created": created,
        "conflicts_skipped": conflicts_found,
        "total_created": len(created),
        "warning": "Redis unavailable, processed synchronously",
    }


async def create_schedule(data: ScheduleCreate, user: SchedulerRequired):
    """Create one or more schedules. Supports recurrence patterns and multiple employees.
    Each schedule document contains all employees (attendees model)."""
    location, employees, class_doc = await _fetch_schedule_entities(data)

    drive_time = (
        data.drive_to_override_minutes
        if data.drive_to_override_minutes
        else location["drive_time_minutes"]
    )
    recurrence_rule = build_recurrence_rule(data)
    dates_to_schedule = build_recurrence_dates(data.date, recurrence_rule)

    if len(dates_to_schedule) == 1:
        return await _handle_single_schedule(
            data,
            dates_to_schedule[0],
            drive_time,
            recurrence_rule,
            location,
            employees,
            class_doc,
            user,
        )

    result = await _handle_bulk_background(
        data,
        dates_to_schedule,
        drive_time,
        recurrence_rule,
        location,
        employees,
        class_doc,
        user,
    )
    if result:
        return result

    return await _handle_bulk_synchronous(
        data,
        dates_to_schedule,
        drive_time,
        recurrence_rule,
        location,
        employees,
        class_doc,
        user,
    )
