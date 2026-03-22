import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import db
from models.schemas import EmployeeCreate, EmployeeUpdate, ErrorResponse
from core.auth import CurrentUser
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/employees", tags=["employees"])

EMPLOYEE_NOT_FOUND = "Employee not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

@router.get("")
async def get_employees(user: CurrentUser):
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    return employees

@router.post("")
async def create_employee(data: EmployeeCreate, user: CurrentUser):
    emp_id = str(uuid.uuid4())
    doc = {
        "id": emp_id,
        "name": data.name,
        "email": data.email,
        "phone": data.phone,
        "color": data.color,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.employees.insert_one(doc)
    doc.pop("_id", None)
    logger.info(f"Employee created: {data.name}", extra={"entity": {"employee_id": emp_id}})
    await log_activity("employee_created", f"Employee '{data.name}' added to team", "employee", emp_id, user.get('name', 'System'))
    return doc

@router.put("/{employee_id}", responses={400: {"model": ErrorResponse, "description": NO_FIELDS_TO_UPDATE}, 404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}})
async def update_employee(employee_id: str, data: EmployeeUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.employees.update_one({"id": employee_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    logger.info(f"Employee updated: {employee_id}", extra={"entity": {"employee_id": employee_id}})
    updated = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    return updated

@router.delete("/{employee_id}", responses={404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}})
async def delete_employee(employee_id: str, user: CurrentUser):
    result = await db.employees.delete_one({"id": employee_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    logger.info(f"Employee deleted: {employee_id}", extra={"entity": {"employee_id": employee_id}})
    return {"message": "Employee deleted"}

@router.get("/{employee_id}/stats", responses={404: {"model": ErrorResponse, "description": EMPLOYEE_NOT_FOUND}})
async def get_employee_stats(employee_id: str, user: CurrentUser):
    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    all_schedules = await db.schedules.find({"employee_id": employee_id}, {"_id": 0}).to_list(1000)
    total_classes = len(all_schedules)
    total_drive_minutes = 0
    total_class_minutes = 0
    completed = 0
    upcoming = 0
    in_progress = 0
    loc_counts = {}
    weekly = {}

    for s in all_schedules:
        total_drive_minutes += s.get('drive_time_minutes', 0) * 2
        try:
            sh, sm = s['start_time'].split(':')
            eh, em = s['end_time'].split(':')
            total_class_minutes += (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
        except (ValueError, KeyError):
            pass

        status = s.get('status', 'upcoming')
        if status == 'completed':
            completed += 1
        elif status == 'upcoming':
            upcoming += 1
        elif status == 'in_progress':
            in_progress += 1

        name = s.get('location_name', 'Unknown')
        loc_counts[name] = loc_counts.get(name, 0) + 1

        week_key = s['date'][:7]
        weekly[week_key] = weekly.get(week_key, 0) + 1

    return {
        "employee": employee,
        "total_classes": total_classes,
        "total_drive_minutes": total_drive_minutes,
        "total_class_minutes": total_class_minutes,
        "completed": completed,
        "upcoming": upcoming,
        "in_progress": in_progress,
        "location_breakdown": [{"name": k, "count": v} for k, v in loc_counts.items()],
        "monthly_breakdown": [{"month": k, "count": v} for k, v in sorted(weekly.items())],
        "recent_schedules": sorted(all_schedules, key=lambda x: x.get('date', ''), reverse=True)[:10]
    }
