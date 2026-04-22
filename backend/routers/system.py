from datetime import datetime, timezone
from fastapi import APIRouter
from database import db
from core.auth import CurrentUser, AdminRequired
from core.logger import get_logger
from core.queue import get_redis_pool

logger = get_logger(__name__)

router = APIRouter(tags=["system"])
_NOTIFICATION_MAX_DOCS = 10_000
_NOTIFICATION_BATCH_SIZE = 500


@router.get("/system/config", summary="Get system configuration")
async def get_system_config(user: CurrentUser):
    """Return current system feature flags (e.g. Outlook integration status)."""
    from core.outlook_config import OUTLOOK_ENABLED, OUTLOOK_OAUTH_ENABLED
    from core.google_config import GOOGLE_CALENDAR_ENABLED, GOOGLE_OAUTH_ENABLED
    return {
        "outlook_enabled": OUTLOOK_ENABLED,
        "outlook_oauth_enabled": OUTLOOK_OAUTH_ENABLED,
        "google_calendar_enabled": GOOGLE_CALENDAR_ENABLED,
        "google_oauth_enabled": GOOGLE_OAUTH_ENABLED,
    }


@router.get("/activity-logs", summary="Get activity logs")
async def get_activity_logs(user: AdminRequired, limit: int = 30):
    """Return recent activity log entries, newest first. Admin only."""
    logs = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return logs


_LIVE_TYPE_KEYS = {
    "upcoming_class": "schedule.upcoming_today",
    "town_to_town": "schedule.town_to_town",
    "idle_employee": "schedule.idle_employee",
}


def _in_app_enabled(principal, kind: str) -> bool:
    """Whether the live-alert ``kind`` should be surfaced to this user."""
    if principal is None:
        return True
    from services.notification_prefs import get_frequency
    type_key = _LIVE_TYPE_KEYS.get(kind)
    if not type_key:
        return True
    return get_frequency(principal, type_key, "in_app") != "off"


def _build_upcoming_alerts(schedules: list[dict], today: str) -> list[dict]:
    out = []
    for s in schedules:
        if s.get('status', 'upcoming') != 'upcoming':
            continue
        class_title = s.get('class_name') or s.get('location_name', '?')
        emp_names = ", ".join(e.get("name", "?") for e in s.get("employees", [])) or "?"
        out.append({
            "id": f"upcoming-{s['id']}",
            "type": "upcoming_class",
            "title": f"Upcoming: {class_title}",
            "description": (
                f"{emp_names} at "
                f"{s.get('start_time', '?')} - {s.get('end_time', '?')}"
            ),
            "severity": "info",
            "timestamp": s.get('created_at', today),
            "entity_id": s['id'],
        })
    return out


def _build_t2t_alerts(schedules: list[dict], today: str) -> list[dict]:
    return [{
        "id": f"t2t-{s['id']}",
        "type": "town_to_town",
        "title": "Town-to-Town Travel",
        "description": s.get('town_to_town_warning', 'Verify drive time manually'),
        "severity": "warning",
        "timestamp": s.get('created_at', today),
        "entity_id": s['id'],
    } for s in schedules]


async def _build_idle_alerts(today_schedules: list[dict], today: str) -> list[dict]:
    # We need employee_ids for the idle comparison; if the caller gated off
    # upcoming_class we still have to fetch a projection for the idle check.
    schedules_for_ids = today_schedules or await _fetch_all_with_guard(
        db.schedules,
        {"date": today, "deleted_at": None},
        {"_id": 0, "employee_ids": 1},
    )
    employees = await _fetch_all_with_guard(db.employees, {"deleted_at": None}, {"_id": 0})
    scheduled_emp_ids = {eid for s in schedules_for_ids for eid in s.get('employee_ids', [])}
    return [{
        "id": f"idle-{emp['id']}",
        "type": "idle_employee",
        "title": "No classes today",
        "description": f"{emp['name']} has no classes scheduled for today",
        "severity": "info",
        "timestamp": today,
        "entity_id": emp['id'],
    } for emp in employees if emp['id'] not in scheduled_emp_ids]


async def _fetch_all_with_guard(
    collection,
    query: dict,
    projection: dict,
    *,
    batch_size: int = _NOTIFICATION_BATCH_SIZE,
    max_docs: int = _NOTIFICATION_MAX_DOCS,
) -> list[dict]:
    """Read all rows matching ``query`` in bounded batches.

    This avoids hard truncation (e.g. ``to_list(100)``) while keeping an upper
    bound to protect the endpoint from unbounded memory growth.
    """
    docs: list[dict] = []
    skip = 0
    while skip < max_docs:
        rows = await collection.find(query, projection).skip(skip).limit(batch_size).to_list(batch_size)
        if not rows:
            break
        docs.extend(rows)
        skip += len(rows)
        if len(rows) < batch_size:
            break
    return docs[:max_docs]


@router.get("/notifications", summary="Get system notifications")
async def get_notifications(
    user: CurrentUser,
    skip: int = 0,
    limit: int = 200,
):
    """Return upcoming classes, town-to-town warnings, and idle employee alerts.

    This endpoint returns *live-computed* system state — not persisted
    notifications. The persistent inbox lives at
    ``GET /api/v1/notifications/inbox``. We apply the user's in-app
    preferences here so that disabling a type silences it from the bell
    icon too, not only the email channel.
    """
    from services.notification_prefs import load_principal

    logger.info("Fetching system notifications")
    principal = await load_principal("internal", user["user_id"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    notifications: list[dict] = []
    limit = max(1, min(limit, 500))
    skip = max(skip, 0)

    # Project only the fields the alert builders read. Schedule documents
    # carry a lot of denormalized data (full ICS payloads, audit trails,
    # etc.) that we don't need for the bell UI; fetching the whole doc
    # wasted both Mongo→app bandwidth and CPU on BSON decode.
    #
    # Upcoming alerts read: status, class_name, location_name, id,
    # start_time, end_time, created_at, and the employees[].name field.
    # The same rows also feed the idle check, which additionally needs
    # employee_ids.
    today_schedules: list[dict] = []
    if _in_app_enabled(principal, "upcoming_class"):
        today_schedules = await _fetch_all_with_guard(
            db.schedules,
            {"date": today, "deleted_at": None},
            {
                "_id": 0,
                "id": 1,
                "status": 1,
                "class_name": 1,
                "location_name": 1,
                "start_time": 1,
                "end_time": 1,
                "created_at": 1,
                "employees": 1,
                "employee_ids": 1,
            },
        )
        notifications.extend(_build_upcoming_alerts(today_schedules, today))

    if _in_app_enabled(principal, "town_to_town"):
        t2t_schedules = await _fetch_all_with_guard(
            db.schedules,
            {"town_to_town": True, "deleted_at": None},
            {
                "_id": 0,
                "id": 1,
                "town_to_town_warning": 1,
                "created_at": 1,
            },
        )
        notifications.extend(_build_t2t_alerts(t2t_schedules, today))

    if _in_app_enabled(principal, "idle_employee"):
        notifications.extend(await _build_idle_alerts(today_schedules, today))

    ordered = sorted(
        notifications,
        key=lambda x: x.get('severity') == 'warning',
        reverse=True,
    )
    returned = ordered[skip: skip + limit]
    total = len(ordered)
    return {
        "items": returned,
        "total": total,
        "returned": len(returned),
        "has_more": (skip + len(returned)) < total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/system/sync-denormalized", summary="Trigger denormalization sync")
async def manual_sync_denormalized(user: AdminRequired):
    """Enqueue background jobs to sync denormalized fields on all schedules. Admin only."""
    pool = await get_redis_pool()
    if not pool:
        return {"message": "Redis unavailable"}

    # Enqueue sync tasks for all primary entities
    employees = await db.employees.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for emp in employees:
        await pool.enqueue_job(
            "sync_schedules_denormalized", entity_type="employee", entity_id=emp["id"],
        )

    locations = await db.locations.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for loc in locations:
        await pool.enqueue_job(
            "sync_schedules_denormalized", entity_type="location", entity_id=loc["id"],
        )

    classes = await db.classes.find({"deleted_at": None}, {"id": 1}).to_list(1000)
    for cls in classes:
        await pool.enqueue_job(
            "sync_schedules_denormalized", entity_type="class", entity_id=cls["id"],
        )

    return {
        "message": (
            f"Sync tasks enqueued for {len(employees)} employees, "
            f"{len(locations)} locations, and {len(classes)} classes"
        )
    }
