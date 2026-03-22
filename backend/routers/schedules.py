import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Optional, List
from database import db
from models.schemas import ScheduleCreate, ScheduleUpdate, StatusUpdate, ScheduleRelocate, ErrorResponse
from core.auth import CurrentUser, SchedulerRequired, AdminRequired
from services.activity import log_activity
from routers.classes import get_class_snapshot
from services.schedule_utils import (
    build_recurrence_rule, build_recurrence_dates, check_conflicts, time_to_minutes
)
from core.logger import get_logger
from core.constants import STATUS_UPCOMING, STATUS_IN_PROGRESS, STATUS_COMPLETED, DEFAULT_EMPLOYEE_COLOR

logger = get_logger(__name__)

router = APIRouter(prefix="/schedules", tags=["schedules"])

SCHEDULE_NOT_FOUND = "Schedule not found"
LOCATION_NOT_FOUND = "Location not found"
EMPLOYEE_NOT_FOUND = "Employee not found"
CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

@router.get("")
async def get_schedules(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 1000
):
    query = {"deleted_at": None}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        query["date"] = {"$gte": date_from}
    elif date_to:
        query["date"] = {"$lte": date_to}
    if employee_id:
        query["employee_id"] = employee_id
    
    total = await db.schedules.count_documents(query)
    schedules = await db.schedules.find(query, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).skip(skip).limit(limit).to_list(limit)
    return {"items": schedules, "total": total, "skip": skip, "limit": limit}

@router.get("/{schedule_id}", responses={404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}})
async def get_schedule(schedule_id: str, user: CurrentUser):
    schedule = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    return schedule

async def _check_town_to_town(employee_id, sched_date, location_id):
    same_day_schedules = await db.schedules.find({
        "employee_id": employee_id,
        "date": sched_date,
        "location_id": {"$ne": location_id},
        "deleted_at": None
    }, {"_id": 0}).to_list(100)

    if not same_day_schedules:
        return False, None

    location_ids = list({s['location_id'] for s in same_day_schedules})
    other_locations = await db.locations.find({"id": {"$in": location_ids}}, {"_id": 0}).to_list(100)
    loc_map = {loc['id']: loc for loc in other_locations}
    other_cities = [loc_map[s['location_id']]['city_name'] for s in same_day_schedules if s['location_id'] in loc_map]
    warning = f"Town-to-Town Travel Detected: Verify drive time manually. Other locations: {', '.join(other_cities)}"
    return True, warning


def _build_schedule_doc(data, sched_date, drive_time, town_to_town, town_to_town_warning, recurrence_rule, location, employee, class_doc):
    return {
        "id": str(uuid.uuid4()),
        "employee_id": data.employee_id,
        "location_id": data.location_id,
        "date": sched_date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "drive_time_minutes": drive_time,
        "town_to_town": town_to_town,
        "town_to_town_warning": town_to_town_warning,
        "travel_override_minutes": data.travel_override_minutes,
        "notes": data.notes,
        "status": STATUS_UPCOMING,
        "recurrence": data.recurrence,
        "recurrence_end_mode": data.recurrence_end_mode,
        "recurrence_end_date": data.recurrence_end_date,
        "recurrence_occurrences": data.recurrence_occurrences,
        "recurrence_rule": recurrence_rule.model_dump() if recurrence_rule else None,
        "location_name": location['city_name'],
        "employee_name": employee['name'],
        "employee_color": employee.get('color', '#4F46E5'),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
        **get_class_snapshot(class_doc),
    }


async def _fetch_schedule_entities(data: ScheduleCreate):
    location = await db.locations.find_one({"id": data.location_id, "deleted_at": None}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    employee = await db.employees.find_one({"id": data.employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    class_doc = None
    if data.class_id:
        class_doc = await db.classes.find_one({"id": data.class_id, "deleted_at": None}, {"_id": 0})
        if not class_doc:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    return location, employee, class_doc


async def _handle_single_schedule(data: ScheduleCreate, date_to_schedule: str, drive_time: int, recurrence_rule: Optional[any], location: dict, employee: dict, class_doc: Optional[dict], user: SchedulerRequired):
    conflicts = await check_conflicts(data.employee_id, date_to_schedule, data.start_time, data.end_time, drive_time)
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "Schedule conflict detected", "conflicts": conflicts})
        
    town_to_town, town_to_town_warning = await _check_town_to_town(data.employee_id, date_to_schedule, data.location_id)
    doc = _build_schedule_doc(data, date_to_schedule, drive_time, town_to_town, town_to_town_warning, recurrence_rule, location, employee, class_doc)
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)
    logger.info(f"Schedule created: {doc['id']}", extra={"entity": {"schedule_id": doc['id'], "employee_id": data.employee_id, "location_id": data.location_id}})
    
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created",
        description=f"{employee['name']} assigned to {location['city_name']}{class_label} — 1 class starting {data.date}",
        entity_type="schedule",
        entity_id=doc['id'],
        user_name=user.get('name', 'System')
    )
    return doc


async def _handle_bulk_background(data: ScheduleCreate, dates_to_schedule: List[str], drive_time: int, recurrence_rule: Optional[any], location: dict, employee: dict, class_doc: Optional[dict], user: SchedulerRequired):
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
        employee=employee,
        class_doc=class_doc,
        user_name=user.get('name', 'System')
    )
    logger.info(f"Bulk schedules enqueued for {employee['name']}", extra={"entity": {"employee_id": data.employee_id, "location_id": data.location_id, "dates_count": len(dates_to_schedule)}})
    
    class_label = f" for {class_doc['name']}" if class_doc else ""
    await log_activity(
        action="schedule_created_bulk_enqueued",
        description=f"Bulk schedule pipeline queued for {employee['name']} at {location['city_name']}{class_label} ({len(dates_to_schedule)} dates)",
        entity_type="schedule_batch",
        entity_id=str(uuid.uuid4()),
        user_name=user.get('name', 'System')
    )
    return {"message": "Bulk schedule generation is running in the background.", "total_created": len(dates_to_schedule), "background": True}



async def _process_single_date(data, sched_date, drive_time, recurrence_rule, location, employee, class_doc):
    conflicts = await check_conflicts(data.employee_id, sched_date, data.start_time, data.end_time, drive_time)
    if conflicts:
        return None, {"date": sched_date, "conflicts": conflicts}

    town_to_town, town_to_town_warning = await _check_town_to_town(data.employee_id, sched_date, data.location_id)
    doc = _build_schedule_doc(data, sched_date, drive_time, town_to_town, town_to_town_warning, recurrence_rule, location, employee, class_doc)
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)
    return doc, None


async def _handle_bulk_synchronous(data: ScheduleCreate, dates_to_schedule: List[str], drive_time: int, recurrence_rule: Optional[any], location: dict, employee: dict, class_doc: Optional[dict], user: SchedulerRequired):
    created = []
    conflicts_found = []
    for sched_date in dates_to_schedule:
        doc, conflict = await _process_single_date(data, sched_date, drive_time, recurrence_rule, location, employee, class_doc)
        if conflict:
            conflicts_found.append(conflict)
        if doc:
            created.append(doc)

    if created:
        count_label = f"{len(created)} classes" if len(created) > 1 else "class"
        class_label = f" for {class_doc['name']}" if class_doc else ""
        await log_activity(
            action="schedule_created",
            description=f"{employee['name']} assigned to {location['city_name']}{class_label} — {count_label} starting {data.date}",
            entity_type="schedule",
            entity_id=created[0]['id'],
            user_name=user.get('name', 'System')
        )
    return {"created": created, "conflicts_skipped": conflicts_found, "total_created": len(created), "warning": "Redis unavailable, processed synchronously"}


@router.post("", responses={404: {"model": ErrorResponse, "description": "Location or Employee not found"}, 409: {"model": ErrorResponse, "description": "Schedule conflict detected"}})
async def create_schedule(data: ScheduleCreate, user: SchedulerRequired):
    location, employee, class_doc = await _fetch_schedule_entities(data)

    drive_time = data.travel_override_minutes if data.travel_override_minutes else location['drive_time_minutes']
    recurrence_rule = build_recurrence_rule(data)
    dates_to_schedule = build_recurrence_dates(data.date, recurrence_rule)

    if len(dates_to_schedule) == 1:
        return await _handle_single_schedule(data, dates_to_schedule[0], drive_time, recurrence_rule, location, employee, class_doc, user)
    
    result = await _handle_bulk_background(data, dates_to_schedule, drive_time, recurrence_rule, location, employee, class_doc, user)
    if result:
        return result

    return await _handle_bulk_synchronous(data, dates_to_schedule, drive_time, recurrence_rule, location, employee, class_doc, user)


async def _enrich_update_data_with_entities(update_data: dict):
    if 'location_id' in update_data:
        location = await db.locations.find_one({"id": update_data['location_id']}, {"_id": 0})
        if not location:
            raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
        update_data['location_name'] = location['city_name']
        if 'travel_override_minutes' not in update_data:
            update_data['drive_time_minutes'] = location['drive_time_minutes']
    
    if 'employee_id' in update_data:
        employee = await db.employees.find_one({"id": update_data['employee_id']}, {"_id": 0})
        if not employee:
            raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
        update_data['employee_name'] = employee['name']
        update_data['employee_color'] = employee.get('color', DEFAULT_EMPLOYEE_COLOR)

    if 'class_id' in update_data:
        class_doc = await db.classes.find_one({"id": update_data['class_id']}, {"_id": 0})
        if not class_doc:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)
        update_data.update({
            "class_name": class_doc['name'],
            "class_color": class_doc.get('color', '#0F766E'),
            "class_description": class_doc.get('description'),
        })

    if 'travel_override_minutes' in update_data and update_data['travel_override_minutes']:
        update_data['drive_time_minutes'] = update_data['travel_override_minutes']

@router.put("/{schedule_id}", responses={
    400: {"model": ErrorResponse, "description": "No fields to update"},
    404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
})
async def update_schedule(schedule_id: str, data: ScheduleUpdate, user: SchedulerRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    await _enrich_update_data_with_entities(update_data)

    result = await db.schedules.update_one({"id": schedule_id, "deleted_at": None}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(f"Schedule updated: {schedule_id}", extra={"entity": {"schedule_id": schedule_id}})
    updated = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    return updated

@router.delete("/{schedule_id}", responses={404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}})
async def delete_schedule(schedule_id: str, user: SchedulerRequired):
    schedule = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    
    result = await db.schedules.update_one(
        {"id": schedule_id, "deleted_at": None}, 
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(f"Schedule soft-deleted: {schedule_id}", extra={"entity": {"schedule_id": schedule_id}})
    if schedule:
        await log_activity("schedule_deleted", f"Class at {schedule.get('location_name', '?')} on {schedule.get('date', '?')} removed", "schedule", schedule_id, user.get('name', 'System'))
    return {"message": "Schedule deleted"}

@router.post("/{schedule_id}/restore", responses={404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}})
async def restore_schedule(schedule_id: str, user: SchedulerRequired):
    result = await db.schedules.update_one(
        {"id": schedule_id}, 
        {"$set": {"deleted_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(f"Schedule restored: {schedule_id}", extra={"entity": {"schedule_id": schedule_id}})
    await log_activity("schedule_restored", f"Schedule with ID '{schedule_id}' restored", "schedule", schedule_id, user.get('name', 'System'))
    return {"message": "Schedule restored"}

@router.put("/{schedule_id}/status", responses={
    400: {"model": ErrorResponse, "description": "Invalid status"},
    404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND}
})
async def update_schedule_status(schedule_id: str, data: StatusUpdate, user: SchedulerRequired):
    if data.status not in [STATUS_UPCOMING, STATUS_IN_PROGRESS, STATUS_COMPLETED]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_one({"id": schedule_id, "deleted_at": None}, {"$set": {"status": data.status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    logger.info(f"Schedule status updated: {schedule_id} to {data.status}", extra={"entity": {"schedule_id": schedule_id, "status": data.status}})
    updated = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    await log_activity(
        action=f"status_{data.status}",
        description=f"Class at {updated.get('location_name', '?')} marked as {data.status.replace('_', ' ')}",
        entity_type="schedule",
        entity_id=schedule_id,
        user_name=user.get('name', 'System')
    )
    return updated

@router.put("/{schedule_id}/relocate", responses={
    404: {"model": ErrorResponse, "description": SCHEDULE_NOT_FOUND},
    409: {"model": ErrorResponse, "description": "Conflict at new time"}
})
async def relocate_schedule(schedule_id: str, data: ScheduleRelocate, user: SchedulerRequired):
    schedule = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    drive_time = schedule.get('drive_time_minutes', 0)
    conflicts = await check_conflicts(schedule['employee_id'], data.date, data.start_time, data.end_time, drive_time, exclude_id=schedule_id)
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "Conflict at new time", "conflicts": conflicts})

    await db.schedules.update_one({"id": schedule_id, "deleted_at": None}, {"$set": {
        "start_time": data.start_time,
        "end_time": data.end_time,
    }})
    logger.info(f"Schedule relocated: {schedule_id}", extra={"entity": {"schedule_id": schedule_id, "new_date": data.date}})
    updated = await db.schedules.find_one({"id": schedule_id, "deleted_at": None}, {"_id": 0})
    await log_activity("schedule_relocated", f"Class at {updated.get('location_name', '?')} moved to {data.date} {data.start_time}-{data.end_time}", "schedule", schedule_id, user.get('name', 'System'))
    return updated

@router.post("/check-conflicts")
async def check_schedule_conflicts(data: ScheduleCreate, user: CurrentUser):
    location = await db.locations.find_one({"id": data.location_id}, {"_id": 0})
    drive_time = data.travel_override_minutes or (location['drive_time_minutes'] if location else 0)
    conflicts = await check_conflicts(data.employee_id, data.date, data.start_time, data.end_time, drive_time)
    return {"has_conflicts": len(conflicts) > 0, "conflicts": conflicts}
