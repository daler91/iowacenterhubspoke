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

from ._shared import (
    INVALID_TOKEN,
    PROJECT_NOT_FOUND,
    TASK_NOT_FOUND,
    UPLOAD_DIR,
    safe_stored_name,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])


async def _require_partner_project(project_id: str, ctx: dict) -> dict:
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


async def _require_partner_task(task_id: str, project_id: str) -> dict:
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
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
        {"project_id": project_id, "owner": {"$in": ["partner", "both"]}},
        {"_id": 0},
    ).sort("sort_order", 1).to_list(500)
    return {"items": tasks, "total": len(tasks)}


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
    return task


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
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_post_task_comment(
    project_id: str, task_id: str, ctx: PortalContext,
    data: TaskCommentCreate,
):
    await _require_partner_project(project_id, ctx)
    await _require_partner_task(task_id, project_id)

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
        "created_at": now,
    }
    await db.task_comments.insert_one(doc)
    doc.pop("_id", None)
    return doc
