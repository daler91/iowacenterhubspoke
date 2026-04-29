"""Partner portal task endpoints — list, complete, detail, attachments, comments."""

import os
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from core.logger import get_logger
from core.pagination import Paginated, paginated_response
from core.portal_auth import PortalContext
from core.upload import stream_upload_to_disk
from database import db
from models.coordination_schemas import TaskCommentCreate
from services.notification_events import (
    notify_task_comment,
    notify_task_comment_mentions,
)
from services.notification_prefs import (
    prepare_mentions,
    principal_to_member_dict,
    principals_for_project,
)
from services.phase_advance import maybe_auto_advance_phase_for_task

from ._shared import (
    INVALID_TOKEN,
    PROJECT_NOT_FOUND,
    TASK_NOT_FOUND,
    UPLOAD_DIR,
    safe_stored_name,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])

# Mirror the single-project /tasks endpoint's `to_list(500)` cap. The
# bulk endpoint applies this PER PROJECT via $slice so partner orgs with
# many projects don't get globally truncated.
_PORTAL_BULK_TASKS_PER_PROJECT = 500
_PARTNER_TASK_EDITABLE_FIELDS = {"status", "completed", "due_date"}
_PARTNER_TASK_INTERNAL_ONLY_FIELDS = {"spotlight", "at_risk", "private_notes"}


async def _require_partner_project(project_id: str, ctx: dict) -> dict:
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


async def _require_partner_task(task_id: str, project_id: str) -> dict:
    task = await db.tasks.find_one(
        {
            "id": task_id,
            "project_id": project_id,
            "owner": {"$in": ["partner", "both"]},
            "deleted_at": None,
        },
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    return task


@router.get(
    "/projects/{project_id}/tasks",
    summary="Partner's tasks for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_tasks(project_id: str, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)

    tasks = await db.tasks.find(
        {
            "project_id": project_id,
            "owner": {"$in": ["partner", "both"]},
            "deleted_at": None,
        },
        {"_id": 0},
    ).sort("sort_order", 1).to_list(500)
    return {"items": tasks, "total": len(tasks)}


@router.post(
    "/projects/tasks/bulk",
    summary="Partner's tasks for multiple projects in one round-trip",
    responses={401: {"description": INVALID_TOKEN}},
)
async def portal_project_tasks_bulk(
    payload: dict, ctx: PortalContext,
):
    """Return ``{ project_id: [tasks...] }`` for every project the caller
    actually owns.

    The dashboard previously fanned out one /projects/{id}/tasks request
    per project, which scaled with the partner's project count. Here we
    do a single ``$in`` query and bucket the results in Python.
    """
    requested = payload.get("project_ids") or []
    if not isinstance(requested, list) or not requested:
        return {"items": {}}
    # Authz: clamp the requested set to the caller's own projects so a
    # malicious id list can't reach into another partner's data.
    owned_cursor = db.projects.find(
        {
            "id": {"$in": requested},
            "partner_org_id": ctx["partner_org_id"],
            "deleted_at": None,
        },
        {"_id": 0, "id": 1},
    )
    owned_ids = [p["id"] async for p in owned_cursor]
    if not owned_ids:
        return {"items": {}}
    # Cap PER PROJECT (matching the single-project endpoint at 500) instead
    # of globally — a flat to_list cap silently dropped tasks for partners
    # with many projects (Codex P1 r3106089947). $group + $slice gives each
    # project the same headroom regardless of how many projects share the
    # batch.
    pipeline = [
        {"$match": {
            "project_id": {"$in": owned_ids},
            "owner": {"$in": ["partner", "both"]},
            "deleted_at": None,
        }},
        {"$sort": {"sort_order": 1}},
        {"$project": {"_id": 0}},
        {"$group": {"_id": "$project_id", "tasks": {"$push": "$$ROOT"}}},
        {"$project": {
            "_id": 0,
            "project_id": "$_id",
            "tasks": {"$slice": ["$tasks", _PORTAL_BULK_TASKS_PER_PROJECT]},
        }},
    ]
    bucketed: dict[str, list] = {pid: [] for pid in owned_ids}
    async for row in db.tasks.aggregate(pipeline):
        pid = row.get("project_id")
        if pid in bucketed:
            bucketed[pid] = row.get("tasks", [])
    return {"items": bucketed}


@router.patch(
    "/projects/{project_id}/tasks/{task_id}/complete",
    summary="Partner completes a task",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_complete_task(project_id: str, task_id: str, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
        {"_id": 0},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)

    now = datetime.now(timezone.utc).isoformat()
    new_completed = not task.get("completed", False)
    update = {
        "completed": new_completed,
        "completed_at": now if new_completed else None,
        "completed_by": ctx["contact"]["name"] if new_completed else None,
    }
    await db.tasks.update_one({"id": task_id}, {"$set": update})
    task.update(update)
    if new_completed:
        contact = ctx.get("contact") or {}
        await maybe_auto_advance_phase_for_task(
            project_id=project_id,
            completed_task_phase=task.get("phase"),
            actor={"id": contact.get("id"), "name": contact.get("name", "Partner")},
        )
    return task


@router.patch(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Partner updates allowed task fields",
    responses={
        400: {"description": "No editable fields were provided."},
        401: {"description": INVALID_TOKEN},
        404: {"description": TASK_NOT_FOUND},
    },
)
async def portal_update_task(project_id: str, task_id: str, payload: dict, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)
    task = await _require_partner_task(task_id, project_id)

    payload = payload or {}
    provided_keys = set(payload.keys())
    blocked = sorted(provided_keys.intersection(_PARTNER_TASK_INTERNAL_ONLY_FIELDS))
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"Internal-only field(s) are not editable in portal: {', '.join(blocked)}",
        )

    disallowed = sorted(provided_keys - _PARTNER_TASK_EDITABLE_FIELDS)
    if disallowed:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported field(s) for portal task update: {', '.join(disallowed)}",
        )

    update_data = {k: payload[k] for k in _PARTNER_TASK_EDITABLE_FIELDS if k in payload}
    if not update_data:
        raise HTTPException(status_code=400, detail="No editable fields were provided.")

    now = datetime.now(timezone.utc).isoformat()
    contact = ctx.get("contact") or {}
    actor_name = contact.get("name", "Partner")

    if "status" in update_data:
        if update_data["status"] == "completed":
            update_data["completed"] = True
            update_data["completed_at"] = now
            update_data["completed_by"] = actor_name
        else:
            update_data["completed"] = False
            update_data["completed_at"] = None
            update_data["completed_by"] = None
    elif "completed" in update_data:
        if bool(update_data["completed"]):
            update_data["status"] = "completed"
            update_data["completed_at"] = now
            update_data["completed_by"] = actor_name
        else:
            if task.get("status") == "completed":
                update_data["status"] = "to_do"
            update_data["completed_at"] = None
            update_data["completed_by"] = None

    update_data["updated_at"] = now
    update_data["updated_by"] = actor_name
    await db.tasks.update_one({"id": task_id}, {"$set": update_data})

    updated = await db.tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not updated:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    return updated


@router.get(
    "/projects/{project_id}/tasks/{task_id}",
    summary="Partner gets full task detail",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_task_detail(project_id: str, task_id: str, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
        {"_id": 0},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    task["attachments"] = await db.task_attachments.find(
        {"task_id": task_id}, {"_id": 0},
    ).sort("uploaded_at", -1).to_list(200)
    task["comments"] = await db.task_comments.find(
        {"task_id": task_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    task["attachment_count"] = len(task["attachments"])
    task["comment_count"] = len(task["comments"])
    return task


@router.get(
    "/projects/{project_id}/tasks/{task_id}/attachments",
    summary="Partner lists task attachments",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_task_attachments(project_id: str, task_id: str, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)
    atts = await db.task_attachments.find(
        {"task_id": task_id}, {"_id": 0},
    ).sort("uploaded_at", -1).to_list(200)
    return {"items": atts, "total": len(atts)}


@router.post(
    "/projects/{project_id}/tasks/{task_id}/attachments",
    summary="Partner uploads a task attachment",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_upload_task_attachment(
    project_id: str, task_id: str, ctx: PortalContext,
    file: Annotated[UploadFile, File(...)],
):
    await _require_partner_project(project_id, ctx)
    await _require_partner_task(task_id, project_id)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    att_id = str(uuid.uuid4())
    stored_name = safe_stored_name(att_id, file.filename)
    file_path = os.path.join(UPLOAD_DIR, stored_name)
    await stream_upload_to_disk(file, file_path)

    ext = os.path.splitext(stored_name)[1]
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": att_id,
        "task_id": task_id,
        "project_id": project_id,
        "filename": file.filename,
        "file_type": ext.lstrip(".") if ext else "unknown",
        "file_path": stored_name,
        "uploaded_by": ctx["contact"]["name"],
        "uploaded_at": now,
        "version": 1,
    }
    await db.task_attachments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get(
    "/projects/{project_id}/tasks/{task_id}/comments",
    summary="Partner lists task comments",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_task_comments(
    project_id: str, task_id: str, ctx: PortalContext,
    pagination: Paginated,
):
    await _require_partner_project(project_id, ctx)
    total = await db.task_comments.count_documents({"task_id": task_id})
    comments = (
        await db.task_comments.find({"task_id": task_id}, {"_id": 0})
        .sort("created_at", 1)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    return paginated_response(comments, total, pagination)


@router.post(
    "/projects/{project_id}/tasks/{task_id}/comments",
    summary="Partner posts a task comment",
    responses={
        400: {"description": "Parent comment not found for this task"},
        401: {"description": INVALID_TOKEN},
        404: {"description": TASK_NOT_FOUND},
    },
)
async def portal_post_task_comment(
    project_id: str, task_id: str, ctx: PortalContext,
    data: TaskCommentCreate,
):
    project = await _require_partner_project(project_id, ctx)
    task = await _require_partner_task(task_id, project_id)

    if data.parent_comment_id:
        parent = await db.task_comments.find_one(
            {"id": data.parent_comment_id, "task_id": task_id},
            {"_id": 0, "id": 1},
        )
        if not parent:
            raise HTTPException(
                status_code=400,
                detail="Parent comment not found for this task",
            )

    mentioned, stored_mentions = await prepare_mentions(
        project_id=project_id,
        refs_input=data.mentions,
        partner_org_id=project.get("partner_org_id"),
    )

    comment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": comment_id,
        "task_id": task_id,
        "project_id": project_id,
        "sender_type": "partner",
        "sender_name": ctx["contact"]["name"],
        "sender_id": ctx["contact"]["id"],
        "body": data.body,
        "parent_comment_id": data.parent_comment_id,
        "mentions": stored_mentions,
        "created_at": now,
    }
    await db.task_comments.insert_one(doc)
    doc.pop("_id", None)
    actor = {
        "id": ctx["contact"]["id"],
        "user_id": ctx["contact"]["id"],
        "name": ctx["contact"]["name"],
    }
    mention_ids = {p.id for p in mentioned}
    notification_summary = {
        "mentions_requested": len(data.mentions or []),
        "mentions_resolved": len(mentioned),
        "comment_recipients_notified": 0,
        "mention_recipients_notified": 0,
    }
    logger.info(
        "portal_task_comment.created id=%s task_id=%s project_id=%s "
        "sender=partner/%s mentions_requested=%d mentions_resolved=%d",
        comment_id, task_id, project_id, ctx["contact"]["id"],
        notification_summary["mentions_requested"],
        notification_summary["mentions_resolved"],
    )
    notification_summary["comment_recipients_notified"] = await notify_task_comment(
        doc, task, project, actor, mention_ids=mention_ids,
    )
    if mentioned:
        notification_summary["mention_recipients_notified"] = await notify_task_comment_mentions(
            doc, task, project, actor, mentioned,
        )
    logger.info(
        "portal_task_comment.notifications id=%s comment_recipients_notified=%d "
        "mention_recipients_notified=%d",
        comment_id,
        notification_summary["comment_recipients_notified"],
        notification_summary["mention_recipients_notified"],
    )
    doc["notification_summary"] = notification_summary
    return doc


@router.get(
    "/projects/{project_id}/members",
    summary="List members mentionable on this project (portal)",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_members(project_id: str, ctx: PortalContext):
    project = await _require_partner_project(project_id, ctx)
    principals = await principals_for_project(
        project_id=project_id,
        partner_org_id=project.get("partner_org_id"),
    )
    items = [
        principal_to_member_dict(p, include_email=False)
        for p in principals if p.id
    ]
    return {"items": items, "total": len(items)}
