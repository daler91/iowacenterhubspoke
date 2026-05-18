"""Partner portal aggregate workspace endpoints."""

from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query

from core.portal_auth import PortalContext
from database import db
from services.notification_prefs import (
    principal_to_member_dict,
    principals_for_project,
)
from services.notifications import count_unread
from services.portal_activity import list_portal_activity

from ._shared import INVALID_TOKEN, PROJECT_NOT_FOUND

router = APIRouter(prefix="/portal", tags=["portal"])

_PROJECT_LIMIT = 100
_TASK_LIMIT = 500
_DOCUMENT_LIMIT = 200
_MESSAGE_LIMIT = 100
_ATTENTION_TASK_LIMIT = 20
_ACTIVITY_LIMIT = 20
_PARTNER_TASK_OWNERS = ["partner", "both"]


def _project_query(ctx: dict, project_id: Optional[str] = None) -> dict:
    query = {"partner_org_id": ctx["partner_org_id"], "deleted_at": None}
    if project_id:
        query["id"] = project_id
    return query


async def _require_project(project_id: str, ctx: dict) -> dict:
    project = await db.projects.find_one(_project_query(ctx, project_id), {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


def _task_query(project_ids: list[str]) -> dict:
    return {
        "project_id": {"$in": project_ids},
        "owner": {"$in": _PARTNER_TASK_OWNERS},
        "deleted_at": None,
    }


def _decorate_tasks(tasks: list[dict], projects: list[dict]) -> list[dict]:
    by_id = {project["id"]: project for project in projects}
    decorated = []
    for task in tasks:
        project = by_id.get(task.get("project_id"), {})
        decorated.append({
            **task,
            "project_title": project.get("title"),
            "project_event_date": project.get("event_date"),
            "project_phase": project.get("phase"),
            "project_venue_name": project.get("venue_name"),
        })
    return decorated


async def _project_task_counts(project_ids: list[str]) -> dict[str, dict]:
    counts = {
        project_id: {"total": 0, "completed": 0, "open": 0, "overdue": 0}
        for project_id in project_ids
    }
    if not project_ids:
        return counts
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.tasks.find(
        _task_query(project_ids),
        {"_id": 0, "project_id": 1, "completed": 1, "due_date": 1},
    ).to_list(_TASK_LIMIT)
    for row in rows:
        project_id = row.get("project_id")
        if project_id not in counts:
            continue
        counts[project_id]["total"] += 1
        if row.get("completed"):
            counts[project_id]["completed"] += 1
            continue
        counts[project_id]["open"] += 1
        due_date = row.get("due_date")
        if due_date and due_date < now:
            counts[project_id]["overdue"] += 1
    return counts


async def _workspace_projects(ctx: dict) -> list[dict]:
    return await (
        db.projects.find(_project_query(ctx), {"_id": 0})
        .sort("event_date", 1)
        .to_list(_PROJECT_LIMIT)
    )


async def _org_documents(ctx: dict) -> list[dict]:
    return await (
        db.documents.find(
            {
                "partner_org_id": ctx["partner_org_id"],
                "project_id": None,
                "visibility": "shared",
                "deleted_at": None,
            },
            {"_id": 0},
        )
        .sort("uploaded_at", -1)
        .to_list(_DOCUMENT_LIMIT)
    )


@router.get(
    "/workspace",
    summary="Partner portal aggregate workspace",
    responses={401: {"description": INVALID_TOKEN}},
)
async def portal_workspace(ctx: PortalContext):
    projects = await _workspace_projects(ctx)
    project_ids = [project["id"] for project in projects]
    active_projects = [project for project in projects if project.get("phase") != "complete"]
    completed_count = len(projects) - len(active_projects)

    task_counts = await _project_task_counts(project_ids)
    for project in projects:
        project["portal_task_counts"] = task_counts.get(
            project["id"],
            {"total": 0, "completed": 0, "open": 0, "overdue": 0},
        )

    needs_attention = []
    open_tasks = 0
    overdue_tasks = 0
    if project_ids:
        now = datetime.now(timezone.utc).isoformat()
        open_tasks = sum(count["open"] for count in task_counts.values())
        overdue_tasks = sum(count["overdue"] for count in task_counts.values())
        tasks = await (
            db.tasks.find(
                {**_task_query(project_ids), "completed": False},
                {"_id": 0, "details": 0},
            )
            .sort("due_date", 1)
            .limit(_ATTENTION_TASK_LIMIT)
            .to_list(_ATTENTION_TASK_LIMIT)
        )
        needs_attention = _decorate_tasks(tasks, projects)
        for task in needs_attention:
            due_date = task.get("due_date")
            task["is_overdue"] = bool(due_date and due_date < now)

    return {
        "org": ctx["org"],
        "contact": ctx["contact"],
        "summary": {
            "active_projects": len(active_projects),
            "upcoming_classes": len(active_projects),
            "open_tasks": open_tasks,
            "overdue_tasks": overdue_tasks,
            "classes_hosted": completed_count,
        },
        "projects": active_projects,
        "needs_attention": needs_attention,
        "org_documents": await _org_documents(ctx),
        "unread_notifications": await count_unread("partner", ctx["contact"]["id"]),
        "recent_activity": await list_portal_activity(
            partner_org_id=ctx["partner_org_id"],
            limit=_ACTIVITY_LIMIT,
        ),
    }


@router.get(
    "/projects/{project_id}/workspace",
    summary="Partner portal project hub workspace",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_workspace(project_id: str, ctx: PortalContext):
    project = await _require_project(project_id, ctx)
    tasks = await (
        db.tasks.find(
            _task_query([project_id]),
            {"_id": 0, "details": 0},
        )
        .sort("sort_order", 1)
        .to_list(_TASK_LIMIT)
    )
    documents = await (
        db.documents.find(
            {
                "project_id": project_id,
                "visibility": "shared",
                "deleted_at": None,
            },
            {"_id": 0},
        )
        .sort("uploaded_at", -1)
        .to_list(_DOCUMENT_LIMIT)
    )
    messages = await (
        db.messages.find(
            {
                "project_id": project_id,
                "visibility": {"$ne": "internal"},
                "deleted_at": None,
            },
            {"_id": 0},
        )
        .sort("created_at", 1)
        .to_list(_MESSAGE_LIMIT)
    )
    principals = await principals_for_project(
        project_id=project_id,
        partner_org_id=project.get("partner_org_id"),
        include_internal=False,
    )
    members = [
        principal_to_member_dict(p, include_email=False)
        for p in principals if p.id
    ]
    return {
        "org": ctx["org"],
        "contact": ctx["contact"],
        "project": project,
        "tasks": tasks,
        "documents": documents,
        "messages": messages,
        "members": members,
        "recent_activity": await list_portal_activity(
            partner_org_id=ctx["partner_org_id"],
            project_id=project_id,
            limit=_ACTIVITY_LIMIT,
        ),
    }


@router.get(
    "/activity",
    summary="Partner portal activity",
    responses={401: {"description": INVALID_TOKEN}},
)
async def portal_activity(
    ctx: PortalContext,
    project_id: Optional[str] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = _ACTIVITY_LIMIT,
):
    if project_id:
        await _require_project(project_id, ctx)
    items = await list_portal_activity(
        partner_org_id=ctx["partner_org_id"],
        project_id=project_id,
        limit=limit,
    )
    return {"items": items, "total": len(items)}
