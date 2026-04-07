import uuid
from datetime import datetime, timezone, timedelta
from database import db
from services.email import send_task_reminder, send_task_overdue
from core.logger import get_logger

logger = get_logger(__name__)


def _classify_task(due: str, now_iso: str, now: datetime):
    """Return (reminder_type, threshold_key, days) for a task."""
    if due < now_iso:
        days_overdue = (now - datetime.fromisoformat(due)).days
        threshold = f"overdue_day_{min(days_overdue, 7)}"
        return "overdue", threshold, days_overdue
    days_until = max(1, (datetime.fromisoformat(due) - now).days)
    return "approaching", "48h", days_until


async def _get_recipients(task, project):
    """Return list of (email, name) tuples for a task's recipients."""
    recipients = []
    if task.get("owner") in ("partner", "both"):
        contacts = await db.partner_contacts.find(
            {
                "partner_org_id": project.get("partner_org_id"),
                "is_primary": True,
                "deleted_at": None,
            },
            {"_id": 0, "email": 1, "name": 1},
        ).to_list(5)
        for c in contacts:
            if c.get("email"):
                recipients.append((c["email"], c["name"]))
    return recipients


async def _send_and_record(
    task, project, email, name,
    reminder_type, threshold, days, now_iso,
):
    """Send a reminder email and record it in the dedup collection."""
    existing = await db.email_reminders.find_one({
        "task_id": task["id"],
        "recipient_email": email,
        "threshold_key": threshold,
    })
    if existing:
        return False

    if reminder_type == "overdue":
        success = await send_task_overdue(
            email, name, task["title"],
            project["title"], task["due_date"], days,
        )
    else:
        success = await send_task_reminder(
            email, name, task["title"],
            project["title"], task["due_date"], days,
        )

    await db.email_reminders.insert_one({
        "id": str(uuid.uuid4()),
        "task_id": task["id"],
        "project_id": task["project_id"],
        "recipient_email": email,
        "reminder_type": reminder_type,
        "threshold_key": threshold,
        "sent_at": now_iso,
        "error": None if success else "send_failed",
    })
    return success


async def check_and_send_reminders():
    """Check for tasks approaching or past due and send reminders."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    soon = (now + timedelta(hours=48)).isoformat()

    tasks = await db.tasks.find(
        {"completed": False, "due_date": {"$lt": soon}},
        {"_id": 0},
    ).to_list(5000)

    sent_count = 0
    for task in tasks:
        due = task.get("due_date", "")
        if not due:
            continue

        project = await db.projects.find_one(
            {"id": task["project_id"], "deleted_at": None},
            {"_id": 0, "title": 1, "partner_org_id": 1},
        )
        if not project:
            continue

        rtype, threshold, days = _classify_task(due, now_iso, now)
        recipients = await _get_recipients(task, project)

        for email, name in recipients:
            success = await _send_and_record(
                task, project, email, name,
                rtype, threshold, days, now_iso,
            )
            if success:
                sent_count += 1

    logger.info("Task reminders: sent %d emails", sent_count)
    return sent_count
