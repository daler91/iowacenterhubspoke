from datetime import datetime, timezone
from fastapi import APIRouter
from database import db
from core.auth import CurrentUser, AdminRequired
from core.logger import get_logger
from core.queue import get_redis_pool

logger = get_logger(__name__)

router = APIRouter(tags=["system"])


@router.get("/system/config", summary="Get system configuration")
async def get_system_config(user: CurrentUser):
    """Return current system feature flags (e.g. Outlook integration status)."""
    from core.outlook_config import OUTLOOK_ENABLED
    return {"outlook_enabled": OUTLOOK_ENABLED}

@router.get("/activity-logs", summary="Get activity logs")
async def get_activity_logs(user: AdminRequired, limit: int = 30):
    """Return recent activity log entries, newest first. Admin only."""
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs

@router.get("/notifications", summary="Get system notifications")
async def get_notifications(user: CurrentUser):
    """Return upcoming classes, town-to-town warnings, and idle employee alerts."""
    logger.info("Fetching system notifications")
    notifications = []
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Today's upcoming classes
    today_schedules = await db.schedules.find({"date": today, "deleted_at": None}, {"_id": 0}).to_list(100)
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
    t2t_schedules = await db.schedules.find({"town_to_town": True, "deleted_at": None}, {"_id": 0}).to_list(100)
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
    employees = await db.employees.find({"deleted_at": None}, {"_id": 0}).to_list(100)
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

@router.post("/system/sync-denormalized", summary="Trigger denormalization sync")
async def manual_sync_denormalized(user: AdminRequired):
    """Enqueue background jobs to sync denormalized fields on all schedules. Admin only."""
    pool = await get_redis_pool()
    if not pool:
        return {"message": "Redis unavailable"}
        
    # Enqueue sync tasks for all primary entities
    employees = await db.employees.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for emp in employees:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="employee", entity_id=emp["id"])
        
    locations = await db.locations.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for loc in locations:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="location", entity_id=loc["id"])
        
    classes = await db.classes.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for cls in classes:
        await pool.enqueue_job("sync_schedules_denormalized", entity_type="class", entity_id=cls["id"])
        
    return {"message": f"Sync tasks enqueued for {len(employees)} employees, {len(locations)} locations, and {len(classes)} classes"}
