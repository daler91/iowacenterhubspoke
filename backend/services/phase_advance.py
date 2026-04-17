from datetime import datetime, timezone
from typing import Optional

from core.constants import PROJECT_PHASES, PROJECT_PHASE_ORDER
from core.logger import get_logger
from database import db
from services.activity import log_activity
from services.notification_events import notify_project_phase_advanced

logger = get_logger(__name__)


async def maybe_auto_advance_phase_for_task(
    *,
    project_id: str,
    completed_task_phase: Optional[str],
    actor: dict,
) -> Optional[str]:
    """Advance a project's phase when the just-completed task finished its phase.

    Called after a task transitions from not-completed to completed. No-ops
    unless the completed task belongs to the project's current phase AND every
    task in that phase is now completed. Only ever moves forward one step;
    reopening tasks will not be handled here.

    Returns the new phase on advance, else ``None``. Swallows its own errors
    so a phase-advance problem never bubbles up into the task-completion
    response.
    """
    if not completed_task_phase:
        return None
    try:
        project = await db.projects.find_one(
            {"id": project_id, "deleted_at": None},
            {"_id": 0, "id": 1, "phase": 1, "title": 1, "partner_org_id": 1},
        )
        if not project:
            return None

        current = project.get("phase", "planning")
        if current != completed_task_phase:
            return None

        current_idx = PROJECT_PHASE_ORDER.get(current, 0)
        if current_idx >= len(PROJECT_PHASES) - 1:
            return None
        next_phase = PROJECT_PHASES[current_idx + 1]

        total_in_phase = await db.tasks.count_documents(
            {"project_id": project_id, "phase": current},
        )
        if total_in_phase == 0:
            return None
        remaining = await db.tasks.count_documents(
            {
                "project_id": project_id,
                "phase": current,
                "completed": {"$ne": True},
            },
        )
        if remaining > 0:
            return None

        now = datetime.now(timezone.utc).isoformat()
        result = await db.projects.update_one(
            {"id": project_id, "phase": current, "deleted_at": None},
            {"$set": {"phase": next_phase, "updated_at": now}},
        )
        if not result.modified_count:
            return None

        await log_activity(
            "project_phase_auto_advanced",
            f"Project auto-advanced from {current} to {next_phase} "
            f"(all {current} tasks completed)",
            "project",
            project_id,
            actor.get("name", "System"),
            user_id=actor.get("user_id"),
        )
        await notify_project_phase_advanced(project, current, next_phase, actor)
        return next_phase
    except Exception:
        logger.exception(
            "auto-advance phase failed",
            extra={"context": {"project_id": project_id}},
        )
        return None
