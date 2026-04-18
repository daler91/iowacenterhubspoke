"""Schedule creation: single and recurring (bulk) schedule creation."""

import uuid
from datetime import datetime, timezone
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
    validate_local_time_exists,
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


async def _auto_link_partner_project(
    schedule_doc: dict,
    location: dict,
    class_doc: dict | None,
    user: dict,
) -> str | None:
    """Create a draft project for a schedule landing at a partner-org venue.

    The report flagged schedules and coordination as decoupled — partners
    never learn a class is coming because someone has to remember to spin
    up the project manually. This closes the loop: if the schedule's
    location belongs to an active partner org AND no project already
    points at this schedule, a ``planning`` project is created and linked.

    Non-fatal: any failure is logged and the schedule still stands. We
    never want a coordination issue to block the core scheduling path.
    """
    try:
        partner_org = await db.partner_orgs.find_one(
            {
                "location_id": location["id"],
                "status": {"$in": ["active", "onboarding"]},
                "deleted_at": None,
            },
            {"_id": 0},
        )
        if not partner_org:
            return None

        existing = await db.projects.find_one(
            {"schedule_id": schedule_doc["id"], "deleted_at": None},
            {"_id": 0, "id": 1},
        )
        if existing:
            return existing["id"]

        project_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        title = (
            f"{class_doc['name']} at {partner_org['name']}"
            if class_doc else f"Class at {partner_org['name']}"
        )
        project_doc = {
            "id": project_id,
            "title": title,
            "event_format": "workshop",
            "partner_org_id": partner_org["id"],
            "partner_org_name": partner_org["name"],
            "template_id": None,
            "schedule_id": schedule_doc["id"],
            "class_id": schedule_doc.get("class_id"),
            "event_date": schedule_doc["date"],
            "phase": "planning",
            "community": partner_org.get("community", location.get("city_name", "")),
            "venue_name": partner_org["name"],
            "venue_details": partner_org.get("venue_details", {}),
            "location_id": location["id"],
            "registration_count": 0,
            "attendance_count": None,
            "warm_leads": None,
            "notes": "Auto-created from schedule.",
            "created_at": now,
            "updated_at": now,
            "created_by": user.get("user_id", ""),
            "auto_created_from_schedule": True,
            "deleted_at": None,
        }
        await db.projects.insert_one(project_doc)
        # Mask the identifiers so CodeQL's clear-text-logging rule
        # doesn't trip on UUID values. The 4/4 prefix/suffix still
        # gives ops enough to correlate across services/logs.
        from core.logger import mask_id
        logger.info(
            "Auto-created partner project from schedule",
            extra={"entity": {
                "project_id_masked": mask_id(project_id),
                "schedule_id_masked": mask_id(schedule_doc.get("id")),
                "partner_org_id_masked": mask_id(partner_org.get("id")),
            }},
        )
        await log_activity(
            "project_auto_created",
            f"Project '{title}' auto-created from schedule at {location.get('city_name', '?')}",
            "project", project_id, user.get("name", "System"),
        )
        return project_id
    except Exception:
        from core.logger import mask_id
        logger.exception(
            "Auto-link partner project failed — schedule created anyway",
            extra={"entity": {"schedule_id_masked": mask_id(schedule_doc.get("id"))}},
        )
        return None


async def _check_internal_conflicts(employees, date, start_time, end_time, drive_time):
    """Check internal schedule conflicts for all employees."""
    per_employee = {}
    for emp in employees:
        conflicts = await check_conflicts(
            emp["id"], date, start_time, end_time, drive_time,
        )
        if conflicts:
            per_employee[emp["id"]] = {"name": emp["name"], "conflicts": conflicts}
    return per_employee


async def _check_external_conflicts(employees, data, date_to_schedule):
    """Check Outlook/Google calendar conflicts for all employees."""
    per_employee = {}
    for emp in employees:
        if not data.force_outlook:
            outlook = await check_outlook_conflicts(
                emp["id"], date_to_schedule, data.start_time, data.end_time
            )
            if outlook:
                per_employee.setdefault(emp["id"], {})["outlook"] = outlook
                per_employee[emp["id"]]["name"] = emp["name"]

        if not data.force_google:
            google = await check_google_conflicts(
                emp["id"], date_to_schedule, data.start_time, data.end_time
            )
            if google:
                per_employee.setdefault(emp["id"], {})["google"] = google
                per_employee[emp["id"]]["name"] = emp["name"]
    return per_employee


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
    per_employee_conflicts = await _check_internal_conflicts(
        employees, date_to_schedule, data.start_time, data.end_time, drive_time,
    )
    if per_employee_conflicts and not data.force:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Schedule conflict detected",
                "conflicts": [],
                "per_employee_conflicts": per_employee_conflicts,
            },
        )

    # Check Outlook/Google conflicts for ALL employees
    per_employee_external = await _check_external_conflicts(
        employees, data, date_to_schedule,
    )
    if per_employee_external and not (data.force_outlook and data.force_google):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "External calendar conflict detected",
                "conflicts": [],
                "per_employee_external_conflicts": per_employee_external,
            },
        )

    # Check town-to-town for primary employee (used for schedule document fields)
    primary = employees[0]
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
        created_by_user_id=user.get("user_id"),
    )
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)

    # Auto-create a partner-coordination project if the location is a
    # partner venue — keeps scheduling and coordination in sync.
    auto_project_id = await _auto_link_partner_project(doc, location, class_doc, user)
    if auto_project_id:
        doc["linked_project_id"] = auto_project_id

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
    series_id: str | None = None,
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
        series_id=series_id,
        created_by_user_id=user.get("user_id"),
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
    series_id: str | None = None,
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
            series_id=series_id,
            created_by_user_id=user.get("user_id"),
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
    # DST sanity: reject schedules scheduled at an hour that doesn't exist
    # on the spring-forward Sunday (e.g. 02:30 in America/Chicago).
    try:
        validate_local_time_exists(data.date, data.start_time)
        validate_local_time_exists(data.date, data.end_time)
    except ValueError as exc:
        logger.info(
            "DST-invalid time rejected on schedule creation",
            extra={"entity": {
                "date": data.date,
                "start_time": data.start_time,
                "end_time": data.end_time,
            }},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Idempotency: if the client provided a key and we've already processed
    # this request, return the previous result instead of creating a duplicate
    # schedule on a network-retry. Scope the lookup to the same user so a
    # different submitter can't replay someone else's key and leak their
    # schedule back.
    if data.idempotency_key:
        existing = await db.schedules.find_one(
            {
                "idempotency_key": data.idempotency_key,
                "created_by_user_id": user.get("user_id"),
                "deleted_at": None,
            },
            {"_id": 0},
        )
        if existing:
            # Re-attach the linked project id that the original create added
            # in memory — side effects (project create, calendar events,
            # activity log) already fired on the first call; we only need to
            # rehydrate response-shape fields the frontend expects.
            linked = await db.projects.find_one(
                {"schedule_id": existing["id"], "deleted_at": None},
                {"_id": 0, "id": 1},
            )
            if linked:
                existing["linked_project_id"] = linked["id"]
            existing["replayed"] = True
            logger.info(
                "Idempotent schedule-create replay served",
                extra={"entity": {
                    "schedule_id": existing["id"],
                    "user_id": user.get("user_id"),
                }},
            )
            return existing

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

    # Generate a shared series_id for all recurring schedule occurrences
    series_id = str(uuid.uuid4())

    result = await _handle_bulk_background(
        data,
        dates_to_schedule,
        drive_time,
        recurrence_rule,
        location,
        employees,
        class_doc,
        user,
        series_id=series_id,
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
        series_id=series_id,
    )
