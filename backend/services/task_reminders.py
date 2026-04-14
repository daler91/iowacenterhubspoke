"""Task reminder cron — approaching + overdue tasks.

This module drives the hourly cron. For each open task due within 48h or
already past due, it resolves the owning principal(s) and dispatches a
notification (``task.approaching`` or ``task.overdue``). The dispatcher
then:

- Checks the principal's preferences for each channel.
- Honours per-threshold dedup via ``dedup_key`` on the event.
- Sends instantly or enqueues for digest as configured.

Recipient scope
---------------
For partner-owned tasks we target every primary contact of the owning
partner org. For internal-owned tasks we target project members with
``owner`` set to ``internal`` or ``both`` — today this is a no-op (projects
don't track per-task internal owners yet), but the code path is ready for
that planned event.
"""

from datetime import datetime, timezone, timedelta
from core.logger import get_logger
from database import db
from services.notification_prefs import (
    Principal,
    find_principal_by_email,
)
from services.notifications import NotificationEvent, dispatch
from services.email import resolve_app_url


logger = get_logger(__name__)


def _classify_task(due: str, now_iso: str, now: datetime):
    """Return (reminder_type, threshold_key, days) for a task."""
    if due < now_iso:
        days_overdue = (now - datetime.fromisoformat(due)).days
        threshold = f"overdue_day_{min(days_overdue, 7)}"
        return "overdue", threshold, days_overdue
    days_until = max(1, (datetime.fromisoformat(due) - now).days)
    return "approaching", "48h", days_until


async def _partner_principals_for(project: dict) -> list[Principal]:
    """Return partner-contact principals for a project's partner org."""
    contacts = await db.partner_contacts.find(
        {
            "partner_org_id": project.get("partner_org_id"),
            "is_primary": True,
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(10)
    principals: list[Principal] = []
    for c in contacts:
        if not c.get("email"):
            continue
        principals.append(Principal(
            kind="partner",
            id=c["id"],
            email=c.get("email"),
            name=c.get("name"),
            role=None,
            prefs=c.get("notification_preferences") or {},
        ))
    return principals


def _build_event(reminder_type: str, task: dict, project: dict, days: int, threshold: str) -> NotificationEvent:
    title = task.get("title", "Task")
    project_title = project.get("title", "project")
    due_date = task.get("due_date", "")
    app_url = resolve_app_url().rstrip("/")
    # Deep-link uses the task id when present so clicks go straight there;
    # planned path but stable regardless of route evolution.
    link = f"{app_url}/projects/{project.get('id', '')}/tasks/{task.get('id', '')}"

    if reminder_type == "overdue":
        subject = f"Overdue: \"{title}\" was due {days} day(s) ago"
        body = (
            f"The task <strong>{title}</strong> for "
            f"<strong>{project_title}</strong> was due on {due_date} and is "
            f"now <strong>{days} day(s) overdue</strong>. Please complete "
            f"it as soon as possible."
        )
        type_key = "task.overdue"
        severity = "warning"
    else:
        subject = f"Reminder: \"{title}\" is due in {days} day(s)"
        body = (
            f"This is a reminder that the task <strong>{title}</strong> for "
            f"<strong>{project_title}</strong> is due on {due_date}. Please "
            f"complete it at your earliest convenience."
        )
        type_key = "task.approaching"
        severity = "info"

    return NotificationEvent(
        type_key=type_key,
        title=subject,
        body=body,
        link=link,
        entity_type="task",
        entity_id=task.get("id"),
        severity=severity,
        dedup_key=f"{task.get('id', '')}:{threshold}",
        context={"task_title": title, "project_title": project_title, "due_date": due_date},
    )


async def check_and_send_reminders() -> int:
    """Main cron entry point. Returns number of successful deliveries."""
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
            {"_id": 0, "id": 1, "title": 1, "partner_org_id": 1},
        )
        if not project:
            continue

        rtype, threshold, days = _classify_task(due, now_iso, now)

        # Resolve recipients. Partner-owned tasks go to partner contacts;
        # "internal" and "both" would also go to assigned internal users —
        # kept here as a placeholder for when per-task internal owners exist.
        owner = task.get("owner")
        principals: list[Principal] = []
        if owner in ("partner", "both"):
            principals.extend(await _partner_principals_for(project))
        # (internal owner branch would resolve via assignee_email on the task)
        assignee_email = task.get("assignee_email")
        if owner in ("internal", "both") and assignee_email:
            p = await find_principal_by_email(assignee_email)
            if p is not None:
                principals.append(p)

        event = _build_event(rtype, task, project, days, threshold)
        for principal in principals:
            result = await dispatch(principal, event)
            if result.email == "sent" or result.in_app == "sent":
                sent_count += 1

    logger.info("Task reminders: processed %d tasks, %d deliveries", len(tasks), sent_count)
    return sent_count
