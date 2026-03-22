from datetime import datetime, timezone
from fastapi import APIRouter
from database import db
from core.auth import CurrentUser
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["system"])

@router.get("/activity-logs")
async def get_activity_logs(user: CurrentUser, limit: int = 30):
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs

@router.get("/notifications")
async def get_notifications(user: CurrentUser):
    logger.info("Fetching system notifications")
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
