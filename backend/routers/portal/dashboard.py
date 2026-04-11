"""Partner portal dashboard and project-list endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter

from core.logger import get_logger
from core.portal_auth import PortalContext
from database import db

from ._shared import INVALID_TOKEN

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])


@router.get(
    "/dashboard",
    summary="Partner portal dashboard overview",
    responses={401: {"description": INVALID_TOKEN}},
)
async def portal_dashboard(ctx: PortalContext):
    org_id = ctx["partner_org_id"]

    projects = await db.projects.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).sort("event_date", 1).to_list(100)

    project_ids = [p["id"] for p in projects]
    upcoming = [p for p in projects if p.get("phase") != "complete"]
    completed_count = sum(1 for p in projects if p.get("phase") == "complete")

    open_tasks = 0
    overdue_tasks = 0
    now = datetime.now(timezone.utc).isoformat()
    if project_ids:
        tasks = await db.tasks.find(
            {
                "project_id": {"$in": project_ids},
                "owner": {"$in": ["partner", "both"]},
                "completed": False,
            },
            {"_id": 0},
        ).to_list(1000)
        open_tasks = len(tasks)
        overdue_tasks = sum(1 for t in tasks if t.get("due_date", "") < now)

    return {
        "org": ctx["org"],
        "contact": ctx["contact"],
        "upcoming_classes": len(upcoming),
        "open_tasks": open_tasks,
        "overdue_tasks": overdue_tasks,
        "classes_hosted": completed_count,
        "projects": upcoming[:10],
    }


@router.get(
    "/projects",
    summary="List projects for this partner org",
    responses={401: {"description": INVALID_TOKEN}},
)
async def portal_list_projects(ctx: PortalContext):
    projects = await db.projects.find(
        {"partner_org_id": ctx["partner_org_id"], "deleted_at": None}, {"_id": 0}
    ).sort("event_date", -1).to_list(100)
    return {"items": projects, "total": len(projects)}
