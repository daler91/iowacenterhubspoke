import asyncio
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import EmployeeCreate, EmployeeUpdate, ErrorResponse
from core.auth import CurrentUser, AdminRequired
from core.pagination import Paginated, paginated_response
from services.activity import log_activity
from services.workload_cache import invalidate as invalidate_workload_cache
from core.logger import get_logger
from core.queue import get_redis_pool
from routers.stats_aggregation import (
    MATCH, GROUP, IF_NULL, MULTIPLY,
    build_time_expr, build_status_count_field, build_name_breakdown_pipeline,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/employees", tags=["employees"])

EMPLOYEE_NOT_FOUND = "Employee not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


@router.get("", summary="List all employees")
async def get_employees(user: CurrentUser, pagination: Paginated):
    """Return paginated list of active employees."""
    query = {"deleted_at": None}
    total = await db.employees.count_documents(query)
    projection = {"_id": 0, "google_refresh_token": 0, "outlook_refresh_token": 0}
    employees = (
        await db.employees.find(query, projection)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    return paginated_response(employees, total, pagination)


@router.get(
    "/{employee_id}",
    summary="Get a single employee",
    responses={404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}},
)
async def get_employee(employee_id: str, user: CurrentUser):
    projection = {"_id": 0, "google_refresh_token": 0, "outlook_refresh_token": 0}
    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, projection)
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    return employee


@router.post("", summary="Create a new employee")
async def create_employee(data: EmployeeCreate, user: AdminRequired):
    """Add a new employee to the team. Requires admin role."""
    emp_id = str(uuid.uuid4())
    doc = {
        "id": emp_id,
        "name": data.name,
        "email": data.email,
        "phone": data.phone,
        "color": data.color,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None
    }
    await db.employees.insert_one(doc)
    doc.pop("_id", None)
    logger.info("Employee created", extra={"entity": {"employee_id": emp_id}})
    await log_activity(
        "employee_created", f"Employee '{data.name}' added to team",
        "employee", emp_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return doc


@router.put(
    "/{employee_id}",
    summary="Update an employee",
    responses={
        400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE},
        404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND},
    },
)
async def update_employee(employee_id: str, data: EmployeeUpdate, user: AdminRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.employees.update_one({"id": employee_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    logger.info("Employee updated", extra={"entity": {"employee_id": employee_id}})
    updated = await db.employees.find_one({"id": employee_id}, {"_id": 0})

    # Trigger background sync for denormalized fields
    pool = await get_redis_pool()
    if pool:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="employee", entity_id=employee_id)
    else:
        # Fallback: sync inline when Redis/worker isn't available
        # Only update future schedules to preserve historical accuracy
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await db.schedules.update_many(
            {"employee_ids": employee_id, "date": {"$gte": today_str}},
            {"$set": {
                "employees.$[elem].name": updated["name"],
                "employees.$[elem].color": updated.get("color", "#4F46E5"),
            }},
            array_filters=[{"elem.id": employee_id}],
        )
        logger.info(
            "Inline sync completed for employee (future only)",
            extra={"entity": {"employee_id": employee_id}},
        )

    await invalidate_workload_cache()
    return updated


@router.delete(
    "/{employee_id}",
    summary="Soft-delete an employee",
    responses={
        404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND},
        409: {"model": ErrorResponse, "description": "Employee has future schedules"},
    },
)
async def delete_employee(employee_id: str, user: AdminRequired):
    from datetime import date as date_type
    today = date_type.today().isoformat()
    future_count = await db.schedules.count_documents({
        "$or": [{"employee_ids": employee_id}, {"employee_id": employee_id}],
        "date": {"$gte": today},
        "deleted_at": None,
    })
    if future_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {future_count} future schedule(s) assigned to this employee. "
            "Reassign or delete them first."
        )
    result = await db.employees.update_one(
        {"id": employee_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    logger.info(
        "Employee soft-deleted",
        extra={"entity": {"employee_id": employee_id}},
    )
    await log_activity(
        "employee_deleted", f"Employee with ID '{employee_id}' marked as deleted",
        "employee", employee_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return {"message": "Employee deleted"}


@router.post(
    "/{employee_id}/restore",
    summary="Restore a deleted employee",
    responses={404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}},
)
async def restore_employee(employee_id: str, user: AdminRequired):
    result = await db.employees.update_one(
        {"id": employee_id},
        {"$set": {"deleted_at": None}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    logger.info(
        "Employee restored",
        extra={"entity": {"employee_id": employee_id}},
    )
    await log_activity(
        "employee_restored", f"Employee with ID '{employee_id}' restored",
        "employee", employee_id, user.get('name', 'System'),
    )
    await invalidate_workload_cache()
    return {"message": "Employee restored"}


@router.get(
    "/{employee_id}/stats",
    summary="Get employee statistics",
    responses={404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}},
)
async def get_employee_stats(employee_id: str, user: CurrentUser):
    """Return schedule counts, drive/class hours, location breakdown, and recent schedules."""
    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    match_stage = {"employee_ids": employee_id, "deleted_at": None}
    time_expr = build_time_expr()

    # Fan the four independent aggregations out in parallel instead of
    # awaiting them sequentially. On a warm Mongo connection this cuts
    # endpoint latency by roughly N× (one RTT instead of four).
    summary_task = db.schedules.aggregate([
        {MATCH: match_stage},
        {GROUP: {
            "_id": None,
            "total_classes": {"$sum": 1},
            "total_drive_minutes": {"$sum": {MULTIPLY: [{IF_NULL: ["$drive_time_minutes", 0]}, 2]}},
            "total_class_minutes": {"$sum": time_expr},
            "completed": {"$sum": build_status_count_field("completed")},
            "upcoming": {"$sum": build_status_count_field("upcoming")},
            "in_progress": {"$sum": build_status_count_field("in_progress")},
        }},
    ]).to_list(1)

    location_task = db.schedules.aggregate(
        build_name_breakdown_pipeline(match_stage, "$location_name", "Unknown")
    ).to_list(500)

    # Month buckets are YYYY-MM strings. Take the newest 60 (five years)
    # via a descending sort + $limit, then re-sort ascending for the
    # chart consumers that expect oldest-first. A trailing to_list(60)
    # alone after an ascending sort would drop current-year activity
    # for long-tenure employees (>5 yrs), which Codex flagged on PR #259.
    monthly_task = db.schedules.aggregate([
        {MATCH: match_stage},
        {GROUP: {"_id": {"$substr": [{IF_NULL: ["$date", ""]}, 0, 7]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "month": "$_id", "count": 1}},
        {"$sort": {"month": -1}},
        {"$limit": 60},
        {"$sort": {"month": 1}},
    ]).to_list(60)

    recent_task = db.schedules.find(
        match_stage, {"_id": 0},
    ).sort("date", -1).limit(10).to_list(10)

    summary, location_breakdown, monthly_breakdown, recent_schedules = await asyncio.gather(
        summary_task, location_task, monthly_task, recent_task,
    )

    totals = summary[0] if summary else {
        "total_classes": 0, "total_drive_minutes": 0, "total_class_minutes": 0,
        "completed": 0, "upcoming": 0, "in_progress": 0,
    }

    return {
        "employee": employee,
        "total_classes": totals["total_classes"],
        "total_drive_minutes": totals["total_drive_minutes"],
        "total_class_minutes": totals["total_class_minutes"],
        "completed": totals["completed"],
        "upcoming": totals["upcoming"],
        "in_progress": totals["in_progress"],
        "location_breakdown": location_breakdown,
        "monthly_breakdown": monthly_breakdown,
        "recent_schedules": recent_schedules,
    }
