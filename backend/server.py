from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import jwt
import bcrypt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'hubspoke-scheduler-secret-key-2024')
JWT_ALGORITHM = 'HS256'

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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

class ScheduleCreate(BaseModel):
    employee_id: str
    location_id: str
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None

class ScheduleUpdate(BaseModel):
    employee_id: Optional[str] = None
    location_id: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None
    status: Optional[str] = None

class StatusUpdate(BaseModel):
    status: str  # upcoming, in_progress, completed

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

async def get_current_user(authorization: Optional[str] = Header(None)):
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

# ========== AUTH ROUTES ==========

@api_router.post("/auth/register")
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

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user['id'], user['email'], user['name'])
    return {"token": token, "user": {"id": user['id'], "name": user['name'], "email": user['email']}}

@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return {"user_id": user['user_id'], "email": user['email'], "name": user['name']}

# ========== LOCATION ROUTES ==========

@api_router.get("/locations")
async def get_locations(user=Depends(get_current_user)):
    locations = await db.locations.find({}, {"_id": 0}).to_list(100)
    return locations

@api_router.post("/locations")
async def create_location(data: LocationCreate, user=Depends(get_current_user)):
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

@api_router.put("/locations/{location_id}")
async def update_location(location_id: str, data: LocationUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.locations.update_one({"id": location_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    updated = await db.locations.find_one({"id": location_id}, {"_id": 0})
    return updated

@api_router.delete("/locations/{location_id}")
async def delete_location(location_id: str, user=Depends(get_current_user)):
    result = await db.locations.delete_one({"id": location_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"message": "Location deleted"}

# ========== EMPLOYEE ROUTES ==========

@api_router.get("/employees")
async def get_employees(user=Depends(get_current_user)):
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    return employees

@api_router.post("/employees")
async def create_employee(data: EmployeeCreate, user=Depends(get_current_user)):
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

@api_router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, data: EmployeeUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.employees.update_one({"id": employee_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    updated = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    return updated

@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, user=Depends(get_current_user)):
    result = await db.employees.delete_one({"id": employee_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"message": "Employee deleted"}

# ========== SCHEDULE ROUTES ==========

@api_router.get("/schedules")
async def get_schedules(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    employee_id: Optional[str] = None,
    user=Depends(get_current_user)
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
    schedules = await db.schedules.find(query, {"_id": 0}).to_list(1000)
    return schedules

@api_router.post("/schedules")
async def create_schedule(data: ScheduleCreate, user=Depends(get_current_user)):
    # Get location for drive time
    location = await db.locations.find_one({"id": data.location_id}, {"_id": 0})
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    # Check employee exists
    employee = await db.employees.find_one({"id": data.employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    drive_time = location['drive_time_minutes']

    # Check for town-to-town: other schedules same employee same day different location
    same_day_schedules = await db.schedules.find({
        "employee_id": data.employee_id,
        "date": data.date,
        "location_id": {"$ne": data.location_id}
    }, {"_id": 0}).to_list(100)

    town_to_town = len(same_day_schedules) > 0
    town_to_town_warning = None
    if town_to_town:
        other_cities = []
        for s in same_day_schedules:
            loc = await db.locations.find_one({"id": s['location_id']}, {"_id": 0})
            if loc:
                other_cities.append(loc['city_name'])
        town_to_town_warning = f"Town-to-Town Travel Detected: Verify drive time manually. Other locations: {', '.join(other_cities)}"

    schedule_id = str(uuid.uuid4())
    doc = {
        "id": schedule_id,
        "employee_id": data.employee_id,
        "location_id": data.location_id,
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "drive_time_minutes": data.travel_override_minutes if data.travel_override_minutes else drive_time,
        "town_to_town": town_to_town,
        "town_to_town_warning": town_to_town_warning,
        "travel_override_minutes": data.travel_override_minutes,
        "notes": data.notes,
        "status": "upcoming",
        "location_name": location['city_name'],
        "employee_name": employee['name'],
        "employee_color": employee.get('color', '#4F46E5'),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.schedules.insert_one(doc)
    doc.pop("_id", None)
    # Log activity
    await log_activity(
        action="schedule_created",
        description=f"{employee['name']} assigned to {location['city_name']} on {data.date} ({data.start_time}-{data.end_time})",
        entity_type="schedule",
        entity_id=schedule_id,
        user_name=user.get('name', 'System')
    )
    return doc

@api_router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, data: ScheduleUpdate, user=Depends(get_current_user)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if 'location_id' in update_data:
        location = await db.locations.find_one({"id": update_data['location_id']}, {"_id": 0})
        if location:
            update_data['location_name'] = location['city_name']
            if 'travel_override_minutes' not in update_data:
                update_data['drive_time_minutes'] = location['drive_time_minutes']
    
    if 'employee_id' in update_data:
        employee = await db.employees.find_one({"id": update_data['employee_id']}, {"_id": 0})
        if employee:
            update_data['employee_name'] = employee['name']
            update_data['employee_color'] = employee.get('color', '#4F46E5')

    if 'travel_override_minutes' in update_data and update_data['travel_override_minutes']:
        update_data['drive_time_minutes'] = update_data['travel_override_minutes']

    result = await db.schedules.update_one({"id": schedule_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    updated = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    return updated

@api_router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, user=Depends(get_current_user)):
    schedule = await db.schedules.find_one({"id": schedule_id}, {"_id": 0})
    result = await db.schedules.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
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

@api_router.put("/schedules/{schedule_id}/status")
async def update_schedule_status(schedule_id: str, data: StatusUpdate, user=Depends(get_current_user)):
    if data.status not in ["upcoming", "in_progress", "completed"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.schedules.update_one({"id": schedule_id}, {"$set": {"status": data.status}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
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
async def get_activity_logs(limit: int = 30, user=Depends(get_current_user)):
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs

# ========== EMPLOYEE STATS ==========

@api_router.get("/employees/{employee_id}/stats")
async def get_employee_stats(employee_id: str, user=Depends(get_current_user)):
    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    all_schedules = await db.schedules.find({"employee_id": employee_id}, {"_id": 0}).to_list(1000)
    total_classes = len(all_schedules)
    total_drive_minutes = sum(s.get('drive_time_minutes', 0) * 2 for s in all_schedules)
    total_class_minutes = 0
    for s in all_schedules:
        try:
            sh, sm = s['start_time'].split(':')
            eh, em = s['end_time'].split(':')
            total_class_minutes += (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
        except:
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
async def get_notifications(user=Depends(get_current_user)):
    notifications = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Today's upcoming classes
    today_schedules = await db.schedules.find({"date": today}, {"_id": 0}).to_list(100)
    for s in today_schedules:
        if s.get('status', 'upcoming') == 'upcoming':
            notifications.append({
                "id": f"upcoming-{s['id']}",
                "type": "upcoming_class",
                "title": f"Upcoming: {s.get('location_name', '?')}",
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
    scheduled_emp_ids = set(s['employee_id'] for s in today_schedules)
    for emp in employees:
        if emp['id'] not in scheduled_emp_ids:
            notifications.append({
                "id": f"idle-{emp['id']}",
                "type": "idle_employee",
                "title": f"No classes today",
                "description": f"{emp['name']} has no classes scheduled for today",
                "severity": "info",
                "timestamp": today,
                "entity_id": emp['id']
            })

    return sorted(notifications, key=lambda x: x.get('severity') == 'warning', reverse=True)

# ========== WORKLOAD STATS ==========

@api_router.get("/workload")
async def get_workload_stats(user=Depends(get_current_user)):
    employees = await db.employees.find({}, {"_id": 0}).to_list(100)
    all_schedules = await db.schedules.find({}, {"_id": 0}).to_list(1000)

    workload = []
    for emp in employees:
        emp_schedules = [s for s in all_schedules if s['employee_id'] == emp['id']]
        total_class_mins = 0
        total_drive_mins = 0
        for s in emp_schedules:
            try:
                sh, sm = s['start_time'].split(':')
                eh, em = s['end_time'].split(':')
                total_class_mins += (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
            except:
                pass
            total_drive_mins += s.get('drive_time_minutes', 0) * 2

        workload.append({
            "employee_id": emp['id'],
            "employee_name": emp['name'],
            "employee_color": emp.get('color', '#4F46E5'),
            "total_classes": len(emp_schedules),
            "total_class_hours": round(total_class_mins / 60, 1),
            "total_drive_hours": round(total_drive_mins / 60, 1),
            "completed": sum(1 for s in emp_schedules if s.get('status') == 'completed'),
            "upcoming": sum(1 for s in emp_schedules if s.get('status', 'upcoming') == 'upcoming'),
        })

    return workload

# ========== DASHBOARD STATS ==========

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(user=Depends(get_current_user)):
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
