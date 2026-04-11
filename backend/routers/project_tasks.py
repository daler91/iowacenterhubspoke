import uuid
import os
import re
from datetime import datetime, timezone
from typing import Annotated, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import (
    TaskCreate, TaskUpdate, TaskReorder, TaskCommentCreate,
)
from core.auth import CurrentUser
from core.pagination import Paginated, paginated_response
from core.upload import stream_upload_to_disk
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/tasks", tags=["project-tasks"],
)

TASK_NOT_FOUND = "Task not found"
PROJECT_NOT_FOUND = "Project not found"
ATTACHMENT_NOT_FOUND = "Attachment not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

UPLOAD_DIR = os.path.join(ROOT_DIR, "uploads")
_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def _safe_stored_name(doc_id: str, original_filename: str | None) -> str:
    ext = os.path.splitext(original_filename or "")[1]
    if not ext or not _SAFE_EXT_RE.match(ext):
        ext = ""
    return f"{doc_id}{ext}"


async def _verify_project(project_id: str):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


async def _verify_task(project_id: str, task_id: str):
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id}, {"_id": 0},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    return task


async def _enrich_task(task: dict) -> dict:
    """Add attachment_count and comment_count to a task."""
    tid = task["id"]
    task["attachment_count"] = await db.task_attachments.count_documents(
        {"task_id": tid},
    )
    task["comment_count"] = await db.task_comments.count_documents(
        {"task_id": tid},
    )
    return task


# ── CRUD ──────────────────────────────────────────────────────────────


@router.get(
    "",
    summary="List tasks for a project",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def list_tasks(
    project_id: str,
    user: CurrentUser,
    phase: Optional[str] = None,
    owner: Optional[str] = None,
    completed: Optional[bool] = None,
):
    await _verify_project(project_id)
    query: dict = {"project_id": project_id}
    if phase:
        query["phase"] = phase
    if owner:
        query["owner"] = owner
    if completed is not None:
        query["completed"] = completed
    tasks = (
        await db.tasks.find(query, {"_id": 0})
        .sort("sort_order", 1)
        .to_list(1000)
    )
    # Batch-enrich with counts
    task_ids = [t["id"] for t in tasks]
    att_counts: dict = {}
    cmt_counts: dict = {}
    if task_ids:
        for att in await db.task_attachments.aggregate([
            {"$match": {"task_id": {"$in": task_ids}}},
            {"$group": {"_id": "$task_id", "n": {"$sum": 1}}},
        ]).to_list(1000):
            att_counts[att["_id"]] = att["n"]
        for cmt in await db.task_comments.aggregate([
            {"$match": {"task_id": {"$in": task_ids}}},
            {"$group": {"_id": "$task_id", "n": {"$sum": 1}}},
        ]).to_list(1000):
            cmt_counts[cmt["_id"]] = cmt["n"]
    for t in tasks:
        t["attachment_count"] = att_counts.get(t["id"], 0)
        t["comment_count"] = cmt_counts.get(t["id"], 0)
    return {"items": tasks, "total": len(tasks)}


@router.post(
    "",
    summary="Create a custom task",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def create_task(
    project_id: str, data: TaskCreate, user: CurrentUser,
):
    await _verify_project(project_id)
    last_task = (
        await db.tasks.find({"project_id": project_id}, {"sort_order": 1})
        .sort("sort_order", -1)
        .limit(1)
        .to_list(1)
    )
    next_order = (last_task[0]["sort_order"] + 1) if last_task else 0

    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    status = data.status or "to_do"
    is_completed = status == "completed"
    doc = {
        "id": task_id,
        "project_id": project_id,
        "title": data.title,
        "phase": data.phase,
        "owner": data.owner,
        "assigned_to": data.assigned_to,
        "due_date": data.due_date,
        "status": status,
        "completed": is_completed,
        "completed_at": now if is_completed else None,
        "completed_by": user.get("name", "System") if is_completed else None,
        "sort_order": next_order,
        "details": data.details or "",
        "description": data.description or "",
        "spotlight": False,
        "at_risk": False,
        "created_at": now,
    }
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    doc["attachment_count"] = 0
    doc["comment_count"] = 0
    await log_activity(
        "task_created", f"Task '{data.title}' created",
        "task", task_id, user.get("name", "System"),
    )
    return doc


@router.get(
    "/{task_id}",
    summary="Get full task detail with attachments and comments",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def get_task_detail(
    project_id: str, task_id: str, user: CurrentUser,
):
    task = await _verify_task(project_id, task_id)
    attachments = (
        await db.task_attachments.find({"task_id": task_id}, {"_id": 0})
        .sort("uploaded_at", -1)
        .to_list(200)
    )
    comments = (
        await db.task_comments.find({"task_id": task_id}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(500)
    )
    task["attachments"] = attachments
    task["comments"] = comments
    task["attachment_count"] = len(attachments)
    task["comment_count"] = len(comments)
    return task


@router.put(
    "/{task_id}",
    summary="Update a task",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": TASK_NOT_FOUND},
    },
)
async def update_task(
    project_id: str, task_id: str, data: TaskUpdate, user: CurrentUser,
):
    update_data = {
        k: v for k, v in data.model_dump().items() if v is not None
    }
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    # Sync completed fields when status changes
    if "status" in update_data:
        now = datetime.now(timezone.utc).isoformat()
        if update_data["status"] == "completed":
            update_data["completed"] = True
            update_data["completed_at"] = now
            update_data["completed_by"] = user.get("name", "System")
        else:
            update_data["completed"] = False
            update_data["completed_at"] = None
            update_data["completed_by"] = None
    result = await db.tasks.update_one(
        {"id": task_id, "project_id": project_id},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    updated = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return updated


@router.patch(
    "/{task_id}/complete",
    summary="Toggle task completion",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def toggle_task_completion(
    project_id: str, task_id: str, user: CurrentUser,
):
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id}, {"_id": 0},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)

    now = datetime.now(timezone.utc).isoformat()
    new_completed = not task.get("completed", False)
    update = {
        "completed": new_completed,
        "completed_at": now if new_completed else None,
        "completed_by": (
            user.get("name", "System") if new_completed else None
        ),
        "status": "completed" if new_completed else "to_do",
    }
    await db.tasks.update_one({"id": task_id}, {"$set": update})
    task.update(update)
    return task


@router.patch(
    "/reorder",
    summary="Bulk reorder tasks",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def reorder_tasks(
    project_id: str, data: TaskReorder, user: CurrentUser,
):
    await _verify_project(project_id)
    for idx, task_id in enumerate(data.task_ids):
        await db.tasks.update_one(
            {"id": task_id, "project_id": project_id},
            {"$set": {"sort_order": idx}},
        )
    return {"message": "Tasks reordered", "count": len(data.task_ids)}


@router.delete(
    "/{task_id}",
    summary="Delete a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def delete_task(
    project_id: str, task_id: str, user: CurrentUser,
):
    result = await db.tasks.delete_one(
        {"id": task_id, "project_id": project_id},
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    # Clean up attachments and comments
    await db.task_attachments.delete_many({"task_id": task_id})
    await db.task_comments.delete_many({"task_id": task_id})
    await log_activity(
        "task_deleted", f"Task '{task_id}' deleted",
        "task", task_id, user.get("name", "System"),
    )
    return {"message": "Task deleted"}


# ── Attachments ───────────────────────────────────────────────────────


@router.get(
    "/{task_id}/attachments",
    summary="List attachments for a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def list_task_attachments(
    project_id: str, task_id: str, user: CurrentUser,
):
    await _verify_task(project_id, task_id)
    atts = (
        await db.task_attachments.find({"task_id": task_id}, {"_id": 0})
        .sort("uploaded_at", -1)
        .to_list(200)
    )
    return {"items": atts, "total": len(atts)}


@router.post(
    "/{task_id}/attachments",
    summary="Upload an attachment to a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def upload_task_attachment(
    project_id: str,
    task_id: str,
    user: CurrentUser,
    file: Annotated[UploadFile, File(...)],
):
    await _verify_task(project_id, task_id)
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    att_id = str(uuid.uuid4())
    stored_name = _safe_stored_name(att_id, file.filename)
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
        "uploaded_by": user.get("name", "System"),
        "uploaded_at": now,
        "version": 1,
    }
    await db.task_attachments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete(
    "/{task_id}/attachments/{att_id}",
    summary="Delete a task attachment",
    responses={404: {"description": ATTACHMENT_NOT_FOUND}},
)
async def delete_task_attachment(
    project_id: str, task_id: str, att_id: str, user: CurrentUser,
):
    att = await db.task_attachments.find_one(
        {"id": att_id, "task_id": task_id},
    )
    if not att:
        raise HTTPException(status_code=404, detail=ATTACHMENT_NOT_FOUND)
    stored = os.path.basename(att.get("file_path", ""))
    file_path = os.path.join(UPLOAD_DIR, stored)
    if stored and os.path.exists(file_path):
        os.remove(file_path)
    await db.task_attachments.delete_one({"id": att_id})
    return {"message": "Attachment deleted"}


@router.get(
    "/{task_id}/attachments/{att_id}/download",
    summary="Download a task attachment",
    responses={404: {"description": ATTACHMENT_NOT_FOUND}},
)
async def download_task_attachment(
    project_id: str, task_id: str, att_id: str, user: CurrentUser,
):
    att = await db.task_attachments.find_one(
        {"id": att_id, "task_id": task_id}, {"_id": 0},
    )
    if not att:
        raise HTTPException(status_code=404, detail=ATTACHMENT_NOT_FOUND)
    stored = os.path.basename(att.get("file_path", ""))
    file_path = os.path.join(UPLOAD_DIR, stored)
    if not stored or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(file_path, filename=att.get("filename", "download"))


# ── Comments ──────────────────────────────────────────────────────────


@router.get(
    "/{task_id}/comments",
    summary="List comments for a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def list_task_comments(
    project_id: str,
    task_id: str,
    user: CurrentUser,
    pagination: Paginated,
):
    await _verify_task(project_id, task_id)
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
    "/{task_id}/comments",
    summary="Post a comment on a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def post_task_comment(
    project_id: str,
    task_id: str,
    data: TaskCommentCreate,
    user: CurrentUser,
):
    await _verify_task(project_id, task_id)
    comment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": comment_id,
        "task_id": task_id,
        "project_id": project_id,
        "sender_type": "internal",
        "sender_name": user.get("name", "Unknown"),
        "sender_id": user.get("id", ""),
        "body": data.body,
        "created_at": now,
    }
    await db.task_comments.insert_one(doc)
    doc.pop("_id", None)
    return doc
