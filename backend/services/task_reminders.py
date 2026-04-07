import uuid
from datetime import datetime, timezone, timedelta
from database import db
from services.email import send_task_reminder, send_task_overdue
from core.logger import get_logger

logger = get_logger(__name__)


async def check_and_send_reminders():
    """Check for tasks approaching or past due and send reminders."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    soon = (now + timedelta(hours=48)).isoformat()

    # Find incomplete tasks due within 48h or overdue
    tasks = await db.tasks.find(
        {
            "completed": False,
            "due_date": {"$lt": soon},
        },
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

        # Determine reminder type
        if due < now_iso:
            days_overdue = (now - datetime.fromisoformat(due)).days
            reminder_type = "overdue"
            threshold = f"overdue_day_{min(days_overdue, 7)}"
        else:
            days_until = max(
                1,
                (datetime.fromisoformat(due) - now).days,
            )
            reminder_type = "approaching"
            threshold = "48h"

        # Find recipients
        recipients = []

        # Partner contacts (primary)
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
                    recipients.append(
                        (c["email"], c["name"]),
                    )

        for email, name in recipients:
            # Check dedup
            existing = await db.email_reminders.find_one({
                "task_id": task["id"],
                "recipient_email": email,
                "threshold_key": threshold,
            })
            if existing:
                continue

            # Send
            if reminder_type == "overdue":
                success = await send_task_overdue(
                    email, name, task["title"],
                    project["title"], due, days_overdue,
                )
            else:
                success = await send_task_reminder(
                    email, name, task["title"],
                    project["title"], due, days_until,
                )

            # Record
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
            if success:
                sent_count += 1

    logger.info("Task reminders: sent %d emails", sent_count)
    return sent_count
