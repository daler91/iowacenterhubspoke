"""Schedule CRUD operations: list, get, create, update, delete, restore, status, relocate."""

from datetime import datetime, timezone
from time import perf_counter
from typing import Optional

from fastapi import APIRouter, HTTPException
from pymongo import ReturnDocument

from database import db
from models.schemas import (
    ScheduleCreate,
    ScheduleUpdate,
    StatusUpdate,
    ScheduleRelocate,
    ErrorResponse,
)
from core.auth import CurrentUser, SchedulerRequired
from core.pagination import Paginated
from services.activity import log_activity
from services.notification_events import notify_schedule_changed
from services.schedule_utils import check_conflicts
from services.workload_cache import invalidate as invalidate_workload_cache
from core.constants import (
    STATUS_UPCOMING,
    STATUS_IN_PROGRESS,
    STATUS_COMPLETED,
    SCHEDULE_STATUS_TO_PROJECT_PHASE,
    PROJECT_PHASE_ORDER,
)
from routers.schedule_helpers import (
    logger,
    SCHEDULE_NOT_FOUND,
    NO_FIELDS_TO_UPDATE,
    _sync_same_day_town_to_town,
    _delete_calendar_events_for_all,
    resolve_update_relations,
    sync_town_to_town_if_needed,
    sync_calendar_events_if_needed,
    sync_relocate_calendar,
)
from routers.schedule_create import create_schedule as _create_schedule

router = APIRouter(tags=["schedules"])

_SCHEDULE_LIST_LIMIT_MAX = 200


# --- List / Get ---


@router.get("/", summary="List schedules")
async def get_schedules(
    user: CurrentUser,
    pagination: Paginated,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
):
    query = {"deleted_at": None}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        query["date"] = {"$gte": date_from}
    elif date_to:
        query["date"] = {"$lte": date_to}
    if employee_id:
        query["employee_ids"] = employee_id

    start_ts = perf_counter()
    pagination.limit = max(1, min(pagination.limit, _SCHEDULE_LIST_LIMIT_MAX))

    total = await db.schedules.count_documents(query)
    schedules = (
        await db.schedules.find(query, {"_id": 0})
        .sort([("date", 1), ("start_time", 1)])
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    # Enrich with linked project summaries
    schedule_ids = [s["id"] for s in schedules]
    if schedule_ids:
        # Cap large enough that any realistic single-page schedule list
        # (usually <= 100 items) won't be truncated. Log a warning if we
        # hit the cap so ops can tune this rather than silently dropping
        # project links.
        _LINKED_PROJECTS_LIMIT = 2000
        linked_projects = await db.projects.find(
            {"schedule_id": {"$in": schedule_ids}, "deleted_at": None},
            {"_id": 0, "schedule_id": 1, "id": 1, "title": 1, "phase": 1,
             "partner_org_id": 1, "task_total": 1, "task_completed": 1},
        ).to_list(_LINKED_PROJECTS_LIMIT)
        if len(linked_projects) == _LINKED_PROJECTS_LIMIT:
            logger.warning(
                "linked_projects truncated at %d; consider raising the cap",
                _LINKED_PROJECTS_LIMIT,
            )
        project_map = {p["schedule_id"]: p for p in linked_projects}
        for s in schedules:
            proj = project_map.get(s["id"])
            if proj:
                s["linked_project"] = {
                    "id": proj["id"],
                    "title": proj.get("title", ""),
                    "phase": proj.get("phase", "planning"),
                }
    elapsed_ms = round((perf_counter() - start_ts) * 1000, 2)
    logger.info(
        "schedules.list metrics",
        extra={
            "context": {
                "duration_ms": elapsed_ms,
                "query_count": 3 if schedule_ids else 2,
                "result_count": len(schedules),
                "total": total,
                "skip": pagination.skip,
                "limit": pagination.limit,
                "has_more": pagination.skip + len(schedules) < total,
            }
        },
    )
    return {
        "items": schedules,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
        "has_more": pagination.skip + len(schedules) < total,
    }


@router.get(
    "/{schedule_id}",
    summary="Get a single schedule",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def get_schedule(schedule_id: str, user: CurrentUser):
    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    return schedule


# --- Create ---

@router.post(
    "/",
    summary="Create a schedule (single or recurring)",
    responses={
        404: {
            "model": ErrorResponse,
            "description": "Location or Employee not found",
        },
        409: {
            "model": ErrorResponse,
            "description": "Schedule conflict detected",
        },
    },
)
async def create_schedule(data: ScheduleCreate, user: SchedulerRequired):
    result = await _create_schedule(data, user)
    await invalidate_workload_cache()
    return result


# --- Update ---


def _enforce_dst_on_update(update_data: dict, effective_date: str) -> None:
    """Raise 400 if the new start/end fall in a spring-forward gap.

    Only runs for fields that are actually changing; callers may be
    shifting one edge of the window and leaving the other alone.
    """
    from services.schedule_utils import validate_local_time_exists
    for field in ("start_time", "end_time"):
        if field in update_data:
            try:
                validate_local_time_exists(effective_date, update_data[field])
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc


def _version_conflict(current: int, expected: int) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "message": "Schedule was updated by someone else — reload and try again.",
            "current_version": current,
            "your_version": expected,
        },
    )


async def _enforce_dst_across_series(
    series_id: str, today: str, new_start: str | None, new_end: str | None,
) -> None:
    """Reject a series update if any future occurrence would land in a
    DST spring-forward hole with the new start/end times.

    All-or-nothing: a partial series where one slot is bogus is worse
    than failing the whole request up front.
    """
    if not (new_start or new_end):
        return
    from services.schedule_utils import validate_local_time_exists
    future_dates = await db.schedules.distinct(
        "date",
        {"series_id": series_id, "date": {"$gte": today}, "deleted_at": None},
    )
    for sched_date in future_dates:
        try:
            if new_start:
                validate_local_time_exists(sched_date, new_start)
            if new_end:
                validate_local_time_exists(sched_date, new_end)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _sync_linked_project_date(schedule_id: str, new_date: str) -> None:
    """If this schedule backs a coordination project, mirror the date
    change onto the project so the coordination view stays in sync."""
    linked = await db.projects.find_one(
        {"schedule_id": schedule_id, "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if linked:
        await db.projects.update_one(
            {"id": linked["id"]},
            {"$set": {
                "event_date": new_date,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )


@router.put(
    "/{schedule_id}",
    summary="Update a schedule",
    responses={
        400: {"model": ErrorResponse, "description": "No fields to update or DST-invalid time"},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
        409: {"model": ErrorResponse, "description": "Optimistic-concurrency version mismatch"},
    },
)
async def update_schedule(
    schedule_id: str, data: ScheduleUpdate, user: SchedulerRequired
):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    # expected_version is a control field, not a document field.
    expected_version = update_data.pop("expected_version", None)
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    old_schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not old_schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    _enforce_dst_on_update(
        update_data, update_data.get("date") or old_schedule.get("date"),
    )

    # Optimistic concurrency pre-check (fast rejection path).
    current_version = old_schedule.get("version", 0)
    if expected_version is not None and expected_version != current_version:
        raise _version_conflict(current_version, expected_version)

    await resolve_update_relations(schedule_id, update_data)
    update_data["version"] = current_version + 1

    match_filter = {"id": schedule_id, "deleted_at": None}
    if expected_version is not None:
        match_filter["version"] = current_version

    result = await db.schedules.update_one(match_filter, {"$set": update_data})
    if result.matched_count == 0:
        # Race or missing doc. One probe tells us which to return.
        still_exists = await db.schedules.find_one(
            {"id": schedule_id, "deleted_at": None}, {"_id": 0, "version": 1},
        )
        if still_exists and expected_version is not None:
            raise _version_conflict(still_exists.get("version", 0), expected_version)
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    await sync_town_to_town_if_needed(schedule_id, update_data)
    await sync_calendar_events_if_needed(schedule_id, update_data, old_schedule)

    if "date" in update_data:
        await _sync_linked_project_date(schedule_id, update_data["date"])

    logger.info(
        f"Schedule updated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    await invalidate_workload_cache()
    return await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )


# --- Delete / Restore ---

@router.delete(
    "/{schedule_id}",
    summary="Soft-delete a schedule",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def delete_schedule(schedule_id: str, user: SchedulerRequired):
    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule soft-deleted: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    if schedule:
        await _delete_calendar_events_for_all(schedule)
        for emp_id in schedule.get("employee_ids", []):
            await _sync_same_day_town_to_town(
                emp_id,
                schedule["date"],
            )
        await log_activity(
            "schedule_deleted",
            f"Class at {schedule.get('location_name', '?')} on {schedule.get('date', '?')} removed",
            "schedule",
            schedule_id,
            user.get("name", "System"),
        )
        await notify_schedule_changed(schedule, "cancelled", user)
    await invalidate_workload_cache()
    return {"message": "Schedule deleted"}


@router.post(
    "/{schedule_id}/restore",
    summary="Restore a deleted schedule",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
    },
)
async def restore_schedule(schedule_id: str, user: SchedulerRequired):
    result = await db.schedules.update_one(
        {"id": schedule_id}, {"$set": {"deleted_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule restored: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id}},
    )
    await log_activity(
        "schedule_restored",
        f"Schedule with ID '{schedule_id}' restored",
        "schedule",
        schedule_id,
        user.get("name", "System"),
    )
    await invalidate_workload_cache()
    return {"message": "Schedule restored"}


# --- Status / Relocate ---

@router.put(
    "/{schedule_id}/status",
    summary="Update schedule status",
    responses={
        400: {"model": ErrorResponse, "description": "Invalid status"},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    },
)
async def update_schedule_status(
    schedule_id: str, data: StatusUpdate, user: SchedulerRequired
):
    if data.status not in [
        STATUS_UPCOMING,
        STATUS_IN_PROGRESS,
        STATUS_COMPLETED,
    ]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None},
        {"$set": {"status": data.status}, "$inc": {"version": 1}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(
        f"Schedule status updated: {schedule_id} to {data.status}",
        extra={"entity": {"schedule_id": schedule_id, "status": data.status}},
    )
    updated = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    await log_activity(
        action=f"status_{data.status}",
        description=f"Class at {updated.get('location_name', '?')} marked as {data.status.replace('_', ' ')}",
        entity_type="schedule",
        entity_id=schedule_id,
        user_name=user.get("name", "System"),
    )
    # Auto-advance linked project phase when schedule status changes
    linked_project_summary = None
    target_phase = SCHEDULE_STATUS_TO_PROJECT_PHASE.get(data.status)
    if target_phase:
        linked_project = await db.projects.find_one(
            {"schedule_id": schedule_id, "deleted_at": None},
            {"_id": 0, "id": 1, "phase": 1, "title": 1},
        )
        if linked_project:
            linked_project_summary = {
                "id": linked_project["id"],
                "title": linked_project.get("title", ""),
                "phase": linked_project["phase"],
            }
            current_idx = PROJECT_PHASE_ORDER.get(linked_project["phase"], 0)
            target_idx = PROJECT_PHASE_ORDER.get(target_phase, 0)
            if target_idx > current_idx:
                now = datetime.now(timezone.utc).isoformat()
                await db.projects.update_one(
                    {"id": linked_project["id"]},
                    {"$set": {"phase": target_phase, "updated_at": now}},
                )
                linked_project_summary["phase"] = target_phase
                await log_activity(
                    "project_phase_auto_advanced",
                    f"Project auto-advanced to {target_phase} (schedule {data.status})",
                    "project",
                    linked_project["id"],
                    user.get("name", "System"),
                )
    if linked_project_summary:
        updated["linked_project"] = linked_project_summary
    await invalidate_workload_cache()
    return updated


# --- Series operations ---

@router.delete(
    "/series/{series_id}",
    summary="Soft-delete all future schedules in a recurrence series",
    responses={
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    },
)
async def delete_series(series_id: str, user: SchedulerRequired):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).isoformat()
    result = await db.schedules.update_many(
        {"series_id": series_id, "date": {"$gte": today}, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    deleted_count = result.modified_count
    if deleted_count == 0:
        # Distinguish "series doesn't exist" from "series exists but all
        # its schedules are already in the past, or were already deleted
        # by a previous DELETE" — only the first should 404. The probe
        # therefore intentionally omits ``deleted_at: None`` so a retry
        # after a successful delete (network timeout, double-click,
        # idempotent client retry) is still a 200 with deleted_count=0.
        any_existing = await db.schedules.find_one(
            {"series_id": series_id},
            {"_id": 0, "id": 1},
        )
        if not any_existing:
            raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    else:
        logger.info(f"Series {series_id}: soft-deleted {deleted_count} future schedules")
        await log_activity(
            "schedule_series_deleted",
            f"Deleted {deleted_count} future schedule(s) in series",
            "schedule_series", series_id, user.get("name", "System"),
        )
        await invalidate_workload_cache()
    return {"deleted_count": deleted_count, "series_id": series_id}


@router.put(
    "/series/{series_id}",
    summary="Update all future schedules in a recurrence series",
    responses={
        400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    },
)
async def update_series(
    series_id: str, data: ScheduleUpdate, user: SchedulerRequired
):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    # expected_version never applies across a series — the field is for
    # single-doc concurrency; strip it so it doesn't leak into $set.
    update_data.pop("expected_version", None)
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    await _enforce_dst_across_series(
        series_id, today,
        update_data.get("start_time"), update_data.get("end_time"),
    )

    # Resolve relations (location name, employee snapshots, class snapshot)
    # Use a representative schedule to resolve drive overrides
    sample = await db.schedules.find_one(
        {"series_id": series_id, "date": {"$gte": today}, "deleted_at": None},
        {"_id": 0, "id": 1},
    )
    if sample:
        await resolve_update_relations(sample["id"], update_data)

    result = await db.schedules.update_many(
        {"series_id": series_id, "date": {"$gte": today}, "deleted_at": None},
        {"$set": update_data, "$inc": {"version": 1}},
    )
    updated_count = result.modified_count
    if updated_count > 0:
        logger.info(f"Series {series_id}: updated {updated_count} future schedules")
        await log_activity(
            "schedule_series_updated",
            f"Updated {updated_count} future schedule(s) in series",
            "schedule_series", series_id, user.get("name", "System"),
        )
        await invalidate_workload_cache()
    return {"updated_count": updated_count, "series_id": series_id}


async def _check_relocate_conflicts(schedule: dict, data, schedule_id: str):
    """Check conflicts for the first employee when relocating."""
    drive_time = schedule.get("drive_time_minutes", 0)
    employee_ids = schedule.get("employee_ids", [])
    first_employee_id = employee_ids[0] if employee_ids else None
    if not first_employee_id:
        return
    conflicts = await check_conflicts(
        first_employee_id, data.date, data.start_time, data.end_time,
        drive_time, exclude_id=schedule_id,
    )
    if conflicts and not data.force:
        raise HTTPException(
            status_code=409,
            detail={"message": "Conflict at new time", "conflicts": conflicts},
        )


@router.put(
    "/{schedule_id}/relocate",
    summary="Relocate a schedule to a new date/time",
    responses={
        400: {"model": ErrorResponse, "description": "DST-invalid local time"},
        404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
        409: {"model": ErrorResponse, "description": "Conflict at new time or concurrent relocation"},
    },
)
async def relocate_schedule(
    schedule_id: str, data: ScheduleRelocate, user: SchedulerRequired
):
    # Reject DST-nonexistent times on the new slot before we mutate anything.
    from services.schedule_utils import validate_local_time_exists
    try:
        validate_local_time_exists(data.date, data.start_time)
        validate_local_time_exists(data.date, data.end_time)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    schedule = await db.schedules.find_one(
        {"id": schedule_id, "deleted_at": None}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    await _check_relocate_conflicts(schedule, data, schedule_id)

    # Optimistic concurrency: the update only succeeds if the schedule is
    # still anchored at the snapshot we conflict-checked against. A racing
    # relocate against the same row will see filter-miss and 409.
    original_date = schedule.get("date")
    original_start = schedule.get("start_time")
    updated = await db.schedules.find_one_and_update(
        {
            "id": schedule_id,
            "deleted_at": None,
            "date": original_date,
            "start_time": original_start,
        },
        {
            "$set": {
                "date": data.date,
                "start_time": data.start_time,
                "end_time": data.end_time,
            },
            "$inc": {"version": 1},
        },
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(
            status_code=409,
            detail="Schedule changed during relocation; please retry.",
        )
    logger.info(
        f"Schedule relocated: {schedule_id}",
        extra={"entity": {"schedule_id": schedule_id, "new_date": data.date}},
    )

    old_date = original_date
    for emp_id in schedule.get("employee_ids", []):
        await _sync_same_day_town_to_town(emp_id, data.date)
        if old_date and old_date != data.date:
            await _sync_same_day_town_to_town(emp_id, old_date)

    # Mirror the update_schedule behaviour: if this schedule backs a
    # coordination project, keep the project's event_date in sync.
    if old_date != data.date:
        await _sync_linked_project_date(schedule_id, data.date)

    await sync_relocate_calendar(schedule, updated)

    await log_activity(
        "schedule_relocated",
        f"Class at {updated.get('location_name', '?')} moved to {data.date} {data.start_time}-{data.end_time}",
        "schedule",
        schedule_id,
        user.get("name", "System"),
    )
    await notify_schedule_changed(
        updated or schedule, "relocated", user, extra={"new_date": data.date},
    )
    await invalidate_workload_cache()
    return updated
