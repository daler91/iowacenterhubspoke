from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import calendar
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Annotated, List, Optional
import uuid
from datetime import datetime, timezone
import jwt
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'iowa_center_hub')]

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-secret-change-in-production')
JWT_ALGORITHM = 'HS256'

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ========== ERROR CONSTANTS ==========

LOCATION_NOT_FOUND = "Location not found"
EMPLOYEE_NOT_FOUND = "Employee not found"
SCHEDULE_NOT_FOUND = "Schedule not found"
CLASS_NOT_FOUND = "Class type not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

RESPONSES_400 = {400: {"description": "Bad request"}}
RESPONSES_401 = {401: {"description": "Invalid credentials"}}
RESPONSES_404_LOCATION = {404: {"description": LOCATION_NOT_FOUND}}
RESPONSES_404_EMPLOYEE = {404: {"description": EMPLOYEE_NOT_FOUND}}
RESPONSES_404_SCHEDULE = {404: {"description": SCHEDULE_NOT_FOUND}}
RESPONSES_404_CLASS = {404: {"description": CLASS_NOT_FOUND}}
RESPONSES_400_404_LOCATION = {400: {"description": NO_FIELDS_TO_UPDATE}, 404: {"description": LOCATION_NOT_FOUND}}
RESPONSES_400_404_EMPLOYEE = {400: {"description": NO_FIELDS_TO_UPDATE}, 404: {"description": EMPLOYEE_NOT_FOUND}}
RESPONSES_400_404_SCHEDULE = {400: {"description": "Invalid status"}, 404: {"description": SCHEDULE_NOT_FOUND}}
RESPONSES_400_404_CLASS = {400: {"description": NO_FIELDS_TO_UPDATE}, 404: {"description": CLASS_NOT_FOUND}}

# ========== MODELS ==========

class UserRegister(BaseModel):
    name: str
    email: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class LocationCreate(BaseModel):
    city_name: str
    drive_time_minutes: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class LocationUpdate(BaseModel):
    city_name: Optional[str] = None
    drive_time_minutes: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class EmployeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    color: Optional[str] = "#4F46E5"

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    color: Optional[str] = None

class RecurrenceRule(BaseModel):
    interval: int = 1
    frequency: str  # week, month
    weekdays: Optional[List[int]] = None  # 0=Sun ... 6=Sat
    end_mode: Optional[str] = "never"  # never, on_date, after_occurrences
    end_date: Optional[str] = None
    occurrences: Optional[int] = None

class ClassCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#0F766E"

class ClassUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class ScheduleCreate(BaseModel):
    employee_id: str
    location_id: str
    class_id: Optional[str] = None
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None
    recurrence: Optional[str] = None  # none, weekly, biweekly
    recurrence_end_date: Optional[str] = None  # YYYY-MM-DD
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = None
    custom_recurrence: Optional[RecurrenceRule] = None

class ScheduleUpdate(BaseModel):
    employee_id: Optional[str] = None
    location_id: Optional[str] = None
    class_id: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None
    status: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_end_date: Optional[str] = None
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = None
    custom_recurrence: Optional[RecurrenceRule] = None

class StatusUpdate(BaseModel):
    status: str  # upcoming, in_progress, completed

class ScheduleRelocate(BaseModel):
    date: str
    start_time: str
    end_time: str

# ========== AUTH HELPERS ==========

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, name: str) -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'name': name,
        'exp': datetime.now(timezone.utc).timestamp() + 86400 * 7
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def get_current_user(authorization: Annotated[Optional[str], Header()] = None):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Not authenticated')
    token = authorization.split(' ')[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail='Token expired')
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail='Invalid token')

# Reusable annotated dependency
CurrentUser = Annotated[dict, Depends(get_current_user)]

# ========== AUTH ROUTES ==========

@api_router.post("/auth/register", responses={400: {"description": "Email already registered"}})
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "name": data.name,
        "email": data.email,
        "password_hash": hash_password(data.password),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, data.email, data.name)
    return {"token": token, "user": {"id": user_id, "name": data.name, "email": data.email}}

@api_router.post("/auth/login", responses=RESPONSES_401)
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user['id'], user['email'], user['name'])
    return {"token": token, "user": {"id": user['id'], "name": user['name'], "email": user['email']}}

@api_router.get("/auth/me")
async def get_me(user: CurrentUser):
    return {"user_id": user['user_id'], "email": user['email'], "name": user['name']}

# ========== LOCATION ROUTES ==========

@api_router.get("/locations")
async def get_locations(user: CurrentUser):
    locations = await db.locations.find({}, {"_id": 0}).to_list(100)
    return locations

@api_router.post("/locations")
async def create_location(data: LocationCreate, user: CurrentUser):
    loc_id = str(uuid.uuid4())
    doc = {
        "id": loc_id,
        "city_name": data.city_name,
        "drive_time_minutes": data.drive_time_minutes,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.locations.insert_one(doc)
    doc.pop("_id", None)
    await log_activity("location_created", f"Location '{data.city_name}' added ({data.drive_time_minutes}m from Hub)", "location", loc_id, user.get('name', 'System'))
    return doc

@api_router.put("/locations/{location_id}", responses=RESPONSES_400_404_LOCATION)
async def update_location(location_id: str, data: LocationUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.locations.update_one({"id": location_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    updated = await db.locations.find_one({"id": location_id}, {"_id": 0})
    return updated

@api_router.delete("/locations/{location_id}", responses=RESPONSES_404_LOCATION)
async def delete_location(location_id: str, user: CurrentUser):
    result = await db.locations.delete_one({"id": location_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    return {"message": "Location deleted"}

# ========== EMPLOYEE ROUTES ==========

@api_router.get("/employees")
async def get_employees(user: CurrentUser):
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    return employees

@api_router.post("/employees")
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
    await log_activity("employee_created", f"Employee '{data.name}' added to team", "employee", emp_id, user.get('name', 'System'))
    return doc

@api_router.put("/employees/{employee_id}", responses=RESPONSES_400_404_EMPLOYEE)
async def update_employee(employee_id: str, data: EmployeeUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.employees.update_one({"id": employee_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    updated = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    return updated

@api_router.delete("/employees/{employee_id}", responses=RESPONSES_404_EMPLOYEE)
async def delete_employee(employee_id: str, user: CurrentUser):
    result = await db.employees.delete_one({"id": employee_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)
    return {"message": "Employee deleted"}

# ========== CLASS ROUTES ==========

def get_class_snapshot(class_doc: Optional[dict]) -> dict:
    if not class_doc:
        return {
            "class_id": None,
            "class_name": None,
            "class_color": None,
            "class_description": None,
        }

    return {
        "class_id": class_doc["id"],
        "class_name": class_doc["name"],
        "class_color": class_doc.get("color", "#0F766E"),
        "class_description": class_doc.get("description"),
    }

async def sync_class_snapshot(class_doc: dict):
    snapshot = get_class_snapshot(class_doc)
    await db.schedules.update_many(
        {"class_id": class_doc["id"]},
        {"$set": {
            "class_name": snapshot["class_name"],
            "class_color": snapshot["class_color"],
            "class_description": snapshot["class_description"],
        }}
    )

async def enrich_schedules_with_classes(schedules: List[dict]):
    class_ids = list({schedule.get("class_id") for schedule in schedules if schedule.get("class_id")})
    class_map = {}

    if class_ids:
        classes = await db.classes.find({"id": {"$in": class_ids}}, {"_id": 0}).to_list(len(class_ids))
        class_map = {class_doc["id"]: class_doc for class_doc in classes}

    for schedule in schedules:
        class_doc = class_map.get(schedule.get("class_id"))
        if class_doc:
            schedule.update(get_class_snapshot(class_doc))
            continue

        schedule.setdefault("class_name", None)
        schedule.setdefault("class_color", None)
        schedule.setdefault("class_description", None)

    return schedules

@api_router.get("/classes")
async def get_classes(user: CurrentUser):
    classes = await db.classes.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return classes

@api_router.post("/classes")
async def create_class(data: ClassCreate, user: CurrentUser):
    class_id = str(uuid.uuid4())
    doc = {
        "id": class_id,
        "name": data.name,
        "description": data.description,
        "color": data.color,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.classes.insert_one(doc)
    doc.pop("_id", None)
    await log_activity("class_created", f"Class type '{data.name}' added", "class", class_id, user.get('name', 'System'))
    return doc

@api_router.put("/classes/{class_id}", responses=RESPONSES_400_404_CLASS)
async def update_class(class_id: str, data: ClassUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    result = await db.classes.update_one({"id": class_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    updated = await db.classes.find_one({"id": class_id}, {"_id": 0})
    await sync_class_snapshot(updated)
    await log_activity("class_updated", f"Class type '{updated['name']}' updated", "class", class_id, user.get('name', 'System'))
    return updated

@api_router.delete("/classes/{class_id}", responses=RESPONSES_404_CLASS)
async def delete_class(class_id: str, user: CurrentUser):
    class_doc = await db.classes.find_one({"id": class_id}, {"_id": 0})
    if not class_doc:
        raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    await db.schedules.update_many(
        {"class_id": class_id},
        {"$set": {
            "class_id": None,
            "class_name": class_doc["name"],
            "class_color": class_doc.get("color", "#0F766E"),
            "class_description": class_doc.get("description"),
        }}
    )
    await db.classes.delete_one({"id": class_id})
    await log_activity("class_deleted", f"Class type '{class_doc['name']}' deleted", "class", class_id, user.get('name', 'System'))
    return {"message": "Class deleted"}

# ========== CONFLICT DETECTION HELPER ==========

def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(':')
    return int(h) * 60 + int(m)

def calculate_class_minutes(start_time: str, end_time: str) -> int:
    return time_to_minutes(end_time) - time_to_minutes(start_time)

def add_months(source_date, months: int):
    month_index = source_date.month - 1 + months
    year = source_date.year + (month_index // 12)
    month = month_index % 12 + 1
    day = min(source_date.day, calendar.monthrange(year, month)[1])
    return source_date.replace(year=year, month=month, day=day)

def get_start_weekday_value(start_date):
    return (start_date.weekday() + 1) % 7

def build_recurrence_rule(data: ScheduleCreate):
    from datetime import date as dt_date

    start_date = dt_date.fromisoformat(data.date)
    if data.recurrence_end_date:
        default_end_mode = "on_date"
    elif data.recurrence_occurrences:
        default_end_mode = "after_occurrences"
    else:
        default_end_mode = "never"
    end_mode = data.recurrence_end_mode or default_end_mode

    if not data.recurrence or data.recurrence == "none":
        return None

    if data.recurrence == "custom":
        return data.custom_recurrence

    if data.recurrence == "weekly":
        return RecurrenceRule(
            interval=1,
            frequency="week",
            weekdays=[get_start_weekday_value(start_date)],
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    if data.recurrence == "biweekly":
        return RecurrenceRule(
            interval=2,
            frequency="week",
            weekdays=[get_start_weekday_value(start_date)],
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    if data.recurrence == "monthly":
        return RecurrenceRule(
            interval=1,
            frequency="month",
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    return None

def _build_monthly_dates(start_date, interval, occurrence_limit, end_date):
    dates = []
    current = start_date
    while True:
        if end_date and current > end_date:
            break
        dates.append(current.isoformat())
        if occurrence_limit and len(dates) >= occurrence_limit:
            break
        current = add_months(current, interval)
    return dates


def _build_weekly_dates(start_date, interval, weekdays, occurrence_limit, end_date):
    from datetime import timedelta as td
    dates = []
    hard_stop = end_date or (start_date + td(days=366 * 2))
    current = start_date
    while current <= hard_stop:
        weekday_value = (current.weekday() + 1) % 7
        weeks_since_start = (current - start_date).days // 7
        if weekday_value in weekdays and weeks_since_start % interval == 0:
            dates.append(current.isoformat())
            if occurrence_limit and len(dates) >= occurrence_limit:
                break
        current += td(days=1)
    return dates


def _parse_recurrence_limits(rule):
    from datetime import date as dt_date
    default_limit = 24 if rule.frequency == "month" else 52
    occurrence_limit = None
    if rule.end_mode == "after_occurrences":
        occurrence_limit = max(rule.occurrences or 1, 1)
    elif rule.end_mode == "never":
        occurrence_limit = default_limit
    end_date = None
    if rule.end_mode == "on_date" and rule.end_date:
        end_date = dt_date.fromisoformat(rule.end_date)
    return occurrence_limit, end_date


def build_recurrence_dates(start_date_str: str, rule: Optional[RecurrenceRule]):
    from datetime import date as dt_date

    if not rule:
        return [start_date_str]

    start_date = dt_date.fromisoformat(start_date_str)
    interval = max(rule.interval or 1, 1)
    occurrence_limit, end_date = _parse_recurrence_limits(rule)

    if rule.frequency == "month":
        dates = _build_monthly_dates(start_date, interval, occurrence_limit, end_date)
        return dates or [start_date_str]

    weekdays = sorted(set(rule.weekdays or [get_start_weekday_value(start_date)]))
    dates = _build_weekly_dates(start_date, interval, weekdays, occurrence_limit, end_date)
    return dates or [start_date_str]

async def check_conflicts(employee_id: str, date: str, start_time: str, end_time: str, drive_minutes: int, exclude_id: str = None):
    """Check if a proposed schedule conflicts with existing ones for the same employee on the same date."""
    new_start = time_to_minutes(start_time) - drive_minutes
    new_end = time_to_minutes(end_time) + drive_minutes

    query = {"employee_id": employee_id, "date": date}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    existing = await db.schedules.find(query, {"_id": 0}).to_list(100)

    conflicts = []
    for s in existing:
        s_drive = s.get('drive_time_minutes', 0)
        s_start = time_to_minutes(s['start_time']) - s_drive
        s_end = time_to_minutes(s['end_time']) + s_drive
        if new_start < s_end and new_end > s_start:
            conflicts.append({
                "schedule_id": s['id'],
                "location": s.get('location_name', '?'),
                "time": f"{s['start_time']}-{s['end_time']}",
                "overlap": f"Blocks overlap (including {s_drive}m drive)"
            })
    return conflicts

# ========== SCHEDULE ROUTES ==========

@api_router.get("/schedules")
async def get_schedules(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
):
    query = {}
    if date_from and date_to:
        query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from:
        query["date"] = {"$gte": date_from}
    elif date_to:
        query["date"] = {"$lte": date_to}
    if employee_id:
        query["employee_id"] = employee_id
    schedules = await db.schedules.find(query, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).to_list(1000)
    return await enrich_schedules_with_classes(schedules)

async def _check_town_to_town(employee_id, sched_date, location_id):
    same_day_schedules = await db.schedules.find({
        "employee_id": employee_id,
        "date": sched_date,
        "location_id": {"$ne": location_id}
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
        "status": "upcoming",
        "recurrence": data.recurrence,
        "recurrence_end_mode": data.recurrence_end_mode,
        "recurrence_end_date": data.recurrence_end_date,
        "recurrence_occurrences": data.recurrence_occurrences,
        "recurrence_rule": recurrence_rule.model_dump() if recurrence_rule else None,
        "location_name": location['city_name'],
        "employee_name": employee['name'],
        "employee_color": employee.get('color', '#4F46E5'),
        "created_at": datetime.now(timezone.utc).isoformat(),
        **get_class_snapshot(class_doc),
    }


async def _fetch_schedule_entities(data: ScheduleCreate):
    location = await db.locations.find_one({"id": data.location_id}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)

    employee = await db.employees.find_one({"id": data.employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    class_doc = None
    if data.class_id:
        class_doc = await db.classes.find_one({"id": data.class_id}, {"_id": 0})
        if not class_doc:
            raise HTTPException(status_code=404, detail=CLASS_NOT_FOUND)

    return location, employee, class_doc


@api_router.post("/schedules", responses={404: {"description": "Location or Employee not found"}, 409: {"description": "Schedule conflict detected"}})
async def create_schedule(data: ScheduleCreate, user: CurrentUser):
    location, employee, class_doc = await _fetch_schedule_entities(data)

    drive_time = data.travel_override_minutes if data.travel_override_minutes else location['drive_time_minutes']
    recurrence_rule = build_recurrence_rule(data)
    dates_to_schedule = build_recurrence_dates(data.date, recurrence_rule)

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
            action="schedule_created",
            description=f"{employee['name']} assigned to {location['city_name']}{class_label} — {count_label} starting {data.date}",
            entity_type="schedule",
            entity_id=created[0]['id'],
            user_name=user.get('name', 'System')
        )

    if len(dates_to_schedule) == 1:
        if conflicts_found:
            raise HTTPException(status_code=409, detail={"message": "Schedule conflict detected", "conflicts": conflicts_found[0]['conflicts']})
        return created[0]

    return {"created": created, "conflicts_skipped": conflicts_found, "total_created": len(created)}

@api_router.put("/schedules/{schedule_id}", responses=RESPONSES_404_SCHEDULE)
async def update_schedule(schedule_id: str, data: ScheduleUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    
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
        update_data['employee_color'] = employee.get('color', '#4F46E5')

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

    result = await db.schedules.update_one({"id": schedule_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    updated = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    return updated

@api_router.delete("/schedules/{schedule_id}", responses=RESPONSES_404_SCHEDULE)
async def delete_schedule(schedule_id: str, user: CurrentUser):
    schedule = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    result = await db.schedules.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    if schedule:
        await log_activity("schedule_deleted", f"Class at {schedule.get('location_name', '?')} on {schedule.get('date', '?')} removed", "schedule", schedule_id, user.get('name', 'System'))
    return {"message": "Schedule deleted"}

# ========== ACTIVITY LOG HELPER ==========

async def log_activity(action: str, description: str, entity_type: str, entity_id: str, user_name: str = "System"):
    doc = {
        "id": str(uuid.uuid4()),
        "action": action,
        "description": description,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_name": user_name,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(doc)

# ========== SCHEDULE STATUS ==========

@api_router.put("/schedules/{schedule_id}/status", responses=RESPONSES_400_404_SCHEDULE)
async def update_schedule_status(schedule_id: str, data: StatusUpdate, user: CurrentUser):
    if data.status not in ["upcoming", "in_progress", "completed"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_one({"id": schedule_id}, {"$set": {"status": data.status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)
    updated = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    await log_activity(
        action=f"status_{data.status}",
        description=f"Class at {updated.get('location_name', '?')} marked as {data.status.replace('_', ' ')}",
        entity_type="schedule",
        entity_id=schedule_id,
        user_name=user.get('name', 'System')
    )
    return updated

# ========== ACTIVITY LOGS ==========

@api_router.get("/activity-logs")
async def get_activity_logs(user: CurrentUser, limit: int = 30):
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs

# ========== EMPLOYEE STATS ==========

@api_router.get("/employees/{employee_id}/stats", responses=RESPONSES_404_EMPLOYEE)
async def get_employee_stats(employee_id: str, user: CurrentUser):
    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail=EMPLOYEE_NOT_FOUND)

    all_schedules = await db.schedules.find({"employee_id": employee_id}, {"_id": 0}).to_list(1000)
    total_classes = len(all_schedules)
    total_drive_minutes = sum(s.get('drive_time_minutes', 0) * 2 for s in all_schedules)
    total_class_minutes = 0
    for s in all_schedules:
        try:
            sh, sm = s['start_time'].split(':')
            eh, em = s['end_time'].split(':')
            total_class_minutes += (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
        except (ValueError, KeyError):
            pass

    completed = sum(1 for s in all_schedules if s.get('status') == 'completed')
    upcoming = sum(1 for s in all_schedules if s.get('status', 'upcoming') == 'upcoming')
    in_progress = sum(1 for s in all_schedules if s.get('status') == 'in_progress')

    # Locations breakdown
    loc_counts = {}
    for s in all_schedules:
        name = s.get('location_name', 'Unknown')
        loc_counts[name] = loc_counts.get(name, 0) + 1

    # Weekly breakdown (last 4 weeks by date)
    weekly = {}
    for s in all_schedules:
        week_key = s['date'][:7]  # YYYY-MM grouping
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

# ========== NOTIFICATIONS ==========

@api_router.get("/notifications")
async def get_notifications(user: CurrentUser):
    notifications = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Today's upcoming classes
    today_schedules = await db.schedules.find({"date": today}, {"_id": 0}).to_list(100)
    for s in today_schedules:
        if s.get('status', 'upcoming') == 'upcoming':
            class_title = s.get('class_name') or s.get('location_name', '?')
            notifications.append({
                "id": f"upcoming-{s['id']}",
                "type": "upcoming_class",
                "title": f"Upcoming: {class_title}",
                "description": f"{s.get('employee_name', '?')} at {s.get('start_time', '?')} - {s.get('end_time', '?')}",
                "severity": "info",
                "timestamp": s.get('created_at', today),
                "entity_id": s['id']
            })

    # Town-to-town warnings
    t2t_schedules = await db.schedules.find({"town_to_town": True}, {"_id": 0}).to_list(100)
    for s in t2t_schedules:
        notifications.append({
            "id": f"t2t-{s['id']}",
            "type": "town_to_town",
            "title": "Town-to-Town Travel",
            "description": s.get('town_to_town_warning', 'Verify drive time manually'),
            "severity": "warning",
            "timestamp": s.get('created_at', today),
            "entity_id": s['id']
        })

    # Unassigned check - employees with no schedules this week
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    scheduled_emp_ids = {s['employee_id'] for s in today_schedules}
    for emp in employees:
        if emp['id'] not in scheduled_emp_ids:
            notifications.append({
                "id": f"idle-{emp['id']}",
                "type": "idle_employee",
                "title": "No classes today",
                "description": f"{emp['name']} has no classes scheduled for today",
                "severity": "info",
                "timestamp": today,
                "entity_id": emp['id']
            })

    return sorted(notifications, key=lambda x: x.get('severity') == 'warning', reverse=True)

# ========== WORKLOAD STATS ==========

@api_router.get("/workload")
async def get_workload_stats(user: CurrentUser):
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    all_schedules = await db.schedules.find({}, {"_id": 0}).to_list(1000)

    workload = []
    for emp in employees:
        emp_schedules = [s for s in all_schedules if s['employee_id'] == emp['id']]
        total_class_mins = 0
        total_drive_mins = 0
        class_breakdown = {}
        for s in emp_schedules:
            try:
                sh, sm = s['start_time'].split(':')
                eh, em = s['end_time'].split(':')
                class_minutes = (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
                total_class_mins += class_minutes
            except (ValueError, KeyError):
                class_minutes = 0
            drive_minutes = s.get('drive_time_minutes', 0) * 2
            total_drive_mins += drive_minutes

            class_key = s.get('class_id') or f"archived::{s.get('class_name') or 'Unassigned'}"
            if class_key not in class_breakdown:
                class_breakdown[class_key] = {
                    "class_id": s.get('class_id'),
                    "class_name": s.get('class_name') or 'Unassigned',
                    "class_color": s.get('class_color') or '#94A3B8',
                    "classes": 0,
                    "class_minutes": 0,
                    "drive_minutes": 0,
                }

            class_breakdown[class_key]['classes'] += 1
            class_breakdown[class_key]['class_minutes'] += class_minutes
            class_breakdown[class_key]['drive_minutes'] += drive_minutes

        workload.append({
            "employee_id": emp['id'],
            "employee_name": emp['name'],
            "employee_color": emp.get('color', '#4F46E5'),
            "total_classes": len(emp_schedules),
            "total_class_hours": round(total_class_mins / 60, 1),
            "total_drive_hours": round(total_drive_mins / 60, 1),
            "completed": sum(1 for s in emp_schedules if s.get('status') == 'completed'),
            "upcoming": sum(1 for s in emp_schedules if s.get('status', 'upcoming') == 'upcoming'),
            "class_breakdown": sorted([
                {
                    **class_data,
                    "class_hours": round(class_data['class_minutes'] / 60, 1),
                    "drive_hours": round(class_data['drive_minutes'] / 60, 1),
                }
                for class_data in class_breakdown.values()
            ], key=lambda class_data: (-class_data['classes'], class_data['class_name'])),
        })

    return workload

# ========== DRAG-DROP RELOCATE ==========

@api_router.put("/schedules/{schedule_id}/relocate", responses=RESPONSES_404_SCHEDULE)
async def relocate_schedule(schedule_id: str, data: ScheduleRelocate, user: CurrentUser):
    """Move a schedule to a new date/time (drag-and-drop support)."""
    schedule = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    if not schedule:
        raise HTTPException(status_code=404, detail=SCHEDULE_NOT_FOUND)

    drive_time = schedule.get('drive_time_minutes', 0)
    conflicts = await check_conflicts(schedule['employee_id'], data.date, data.start_time, data.end_time, drive_time, exclude_id=schedule_id)
    if conflicts:
        raise HTTPException(status_code=409, detail={"message": "Conflict at new time", "conflicts": conflicts})

    await db.schedules.update_one({"id": schedule_id}, {"$set": {
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
    }})
    updated = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    await log_activity("schedule_relocated", f"Class at {updated.get('location_name', '?')} moved to {data.date} {data.start_time}-{data.end_time}", "schedule", schedule_id, user.get('name', 'System'))
    return updated

# ========== WEEKLY SUMMARY REPORT ==========

def _init_employee_summary(emp):
    return {
        "employee_name": emp.get('name', '?'),
        "employee_color": emp.get('color', '#4F46E5'),
        "classes": 0,
        "class_minutes": 0,
        "drive_minutes": 0,
        "locations_visited": set(),
        "days_worked": set(),
        "completed": 0,
        "schedule_details": [],
        "class_breakdown": {},
    }


def _get_class_key_entry(s):
    return {
        "class_id": s.get('class_id'),
        "class_name": s.get('class_name') or 'Unassigned',
        "class_color": s.get('class_color') or '#94A3B8',
    }


def _aggregate_schedule(summary, s, class_totals):
    class_minutes = calculate_class_minutes(s['start_time'], s['end_time'])
    drive_minutes = s.get('drive_time_minutes', 0) * 2
    summary['classes'] += 1
    summary['class_minutes'] += class_minutes
    summary['drive_minutes'] += drive_minutes
    summary['locations_visited'].add(s.get('location_name', '?'))
    summary['days_worked'].add(s['date'])
    if s.get('status') == 'completed':
        summary['completed'] += 1

    class_key = s.get('class_id') or f"archived::{s.get('class_name') or 'Unassigned'}"
    if class_key not in summary['class_breakdown']:
        summary['class_breakdown'][class_key] = {**_get_class_key_entry(s), "classes": 0, "class_minutes": 0, "drive_minutes": 0}
    if class_key not in class_totals:
        class_totals[class_key] = {**_get_class_key_entry(s), "classes": 0, "class_minutes": 0}

    summary['class_breakdown'][class_key]['classes'] += 1
    summary['class_breakdown'][class_key]['class_minutes'] += class_minutes
    summary['class_breakdown'][class_key]['drive_minutes'] += drive_minutes
    class_totals[class_key]['classes'] += 1
    class_totals[class_key]['class_minutes'] += class_minutes

    summary['schedule_details'].append({
        "date": s['date'],
        "location": s.get('location_name', '?'),
        "time": f"{s['start_time']}-{s['end_time']}",
        "drive_minutes": s.get('drive_time_minutes', 0),
        "status": s.get('status', 'upcoming'),
        **_get_class_key_entry(s),
    })


def _finalize_summaries(employee_summaries, class_totals):
    result = []
    for summary in employee_summaries.values():
        summary['locations_visited'] = list(summary['locations_visited'])
        summary['days_worked'] = len(summary['days_worked'])
        summary['class_hours'] = round(summary['class_minutes'] / 60, 1)
        summary['drive_hours'] = round(summary['drive_minutes'] / 60, 1)
        summary['class_breakdown'] = sorted([
            {**cd, "class_hours": round(cd['class_minutes'] / 60, 1), "drive_hours": round(cd['drive_minutes'] / 60, 1)}
            for cd in summary['class_breakdown'].values()
        ], key=lambda cd: (-cd['classes'], cd['class_name']))
        result.append(summary)

    total_classes = sum(s['classes'] for s in result)
    total_drive_hrs = sum(s['drive_hours'] for s in result)
    total_class_hrs = sum(s['class_hours'] for s in result)

    finalized_class_totals = sorted([
        {**cd, "class_hours": round(cd['class_minutes'] / 60, 1)}
        for cd in class_totals.values()
    ], key=lambda cd: (-cd['classes'], cd['class_name']))

    return result, total_classes, total_class_hrs, total_drive_hrs, finalized_class_totals


@api_router.get("/reports/weekly-summary")
async def get_weekly_summary(user: CurrentUser, date_from: Optional[str] = None, date_to: Optional[str] = None, class_id: Optional[str] = None):
    """Generate a weekly summary report."""
    from datetime import date as dt_date, timedelta as td
    if not date_from:
        today = dt_date.today()
        start = today - td(days=today.weekday())
        date_from = start.isoformat()
        date_to = (start + td(days=6)).isoformat()

    query = {"date": {"$gte": date_from, "$lte": date_to}}
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(query, {"_id": 0}).to_list(1000)
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    emp_map = {e['id']: e for e in employees}

    employee_summaries = {}
    class_totals = {}
    for s in schedules:
        eid = s['employee_id']
        if eid not in employee_summaries:
            employee_summaries[eid] = _init_employee_summary(emp_map.get(eid, {}))
        _aggregate_schedule(employee_summaries[eid], s, class_totals)

    result, total_classes, total_class_hrs, total_drive_hrs, finalized_class_totals = _finalize_summaries(employee_summaries, class_totals)

    return {
        "period": {"from": date_from, "to": date_to},
        "totals": {
            "classes": total_classes,
            "class_hours": total_class_hrs,
            "drive_hours": total_drive_hrs,
            "employees_active": len(result),
        },
        "class_totals": finalized_class_totals,
        "employees": sorted(result, key=lambda x: x['classes'], reverse=True),
    }

# ========== CONFLICT CHECK ENDPOINT ==========

@api_router.post("/schedules/check-conflicts")
async def check_schedule_conflicts(data: ScheduleCreate, user: CurrentUser):
    """Pre-check for conflicts before creating a schedule."""
    location = await db.locations.find_one({"id": data.location_id}, {"_id": 0})
    drive_time = data.travel_override_minutes or (location['drive_time_minutes'] if location else 0)
    conflicts = await check_conflicts(data.employee_id, data.date, data.start_time, data.end_time, drive_time)
    return {"has_conflicts": len(conflicts) > 0, "conflicts": conflicts}

# ========== DASHBOARD STATS ==========

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(user: CurrentUser):
    total_employees = await db.employees.count_documents({})
    total_locations = await db.locations.count_documents({})
    total_schedules = await db.schedules.count_documents({})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_schedules = await db.schedules.count_documents({"date": today})
    return {
        "total_employees": total_employees,
        "total_locations": total_locations,
        "total_schedules": total_schedules,
        "today_schedules": today_schedules
    }

# ========== SEED DATA ==========

@app.on_event("startup")
async def seed_data():
    count = await db.locations.count_documents({})
    if count == 0:
        default_locations = [
            {"id": str(uuid.uuid4()), "city_name": "Oskaloosa", "drive_time_minutes": 75, "latitude": 41.2964, "longitude": -92.6443, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "city_name": "Grinnell", "drive_time_minutes": 60, "latitude": 41.7431, "longitude": -92.7224, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "city_name": "Fort Dodge", "drive_time_minutes": 105, "latitude": 42.4975, "longitude": -94.1680, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "city_name": "Carroll", "drive_time_minutes": 105, "latitude": 42.0664, "longitude": -94.8669, "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "city_name": "Marshalltown", "drive_time_minutes": 60, "latitude": 42.0492, "longitude": -92.9080, "created_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.locations.insert_many(default_locations)
        logger.info("Seeded default locations")

# ========== APP SETUP ==========

app.include_router(api_router)

# Serve frontend static files (built React app)
_static_dir = ROOT_DIR / "static"
if _static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir / "static")), name="frontend-static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = _static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_static_dir / "index.html"))

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
