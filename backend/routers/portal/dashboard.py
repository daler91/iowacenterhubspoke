"""Partner portal dashboard and project-list endpoints."""

import asyncio
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

    projects = await (
        db.projects.find(
            {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
        )
        .sort("event_date", 1)
        .to_list(100)
    )

    project_ids = [p["id"] for p in projects]
    upcoming = [p for p in projects if p.get("phase") != "complete"]
    completed_count = sum(1 for p in projects if p.get("phase") == "complete")

    open_tasks = 0
    overdue_tasks = 0
    now = datetime.now(timezone.utc).isoformat()
    if project_ids:
        # The two counts query the same task set but with different
        # date predicates — run them in parallel so dashboard latency
        # is bounded by the slower query, not the sum.
        open_cursor, overdue_cursor = await asyncio.gather(
            db.tasks.count_documents({
                "project_id": {"$in": project_ids},
                "owner": {"$in": ["partner", "both"]},
                "completed": False,
                "deleted_at": None,
            }),
            db.tasks.count_documents({
                "project_id": {"$in": project_ids},
                "owner": {"$in": ["partner", "both"]},
                "completed": False,
                "deleted_at": None,
                "due_date": {"$lt": now},
            }),
        )
        open_tasks = open_cursor
        overdue_tasks = overdue_cursor

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
