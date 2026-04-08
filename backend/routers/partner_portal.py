import uuid
import secrets
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Annotated, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import (
    PortalAuthRequest, MessageCreate, TaskCommentCreate,
)
from core.logger import get_logger
from core.portal_auth import PortalContext, validate_portal_token
from core.upload import stream_upload_to_disk

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])

UPLOAD_DIR = os.path.join(ROOT_DIR, "uploads")
TOKEN_EXPIRY_DAYS = 7

PROJECT_NOT_FOUND = "Project not found"
TASK_NOT_FOUND = "Task not found"
INVALID_TOKEN = "Invalid or expired portal link"

_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def _safe_stored_name(doc_id: str, original_filename: str | None) -> str:
    ext = os.path.splitext(original_filename or "")[1]
    if not ext or not _SAFE_EXT_RE.match(ext):
        ext = ""
    return f"{doc_id}{ext}"


# ── Auth Endpoints ────────────────────────────────────────────────────

@router.post("/auth/request-link", summary="Request a magic link for partner access")
async def request_magic_link(data: PortalAuthRequest):
    contact = await db.partner_contacts.find_one(
        {"email": data.email, "deleted_at": None}, {"_id": 0}
    )
    if not contact:
        # Return success even if not found (prevent email enumeration)
        return {"message": "If that email is registered, a link has been sent."}

    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=TOKEN_EXPIRY_DAYS)

    doc = {
        "id": str(uuid.uuid4()),
        "contact_id": contact["id"],
        "token": token,
        "expires_at": expires.isoformat(),
        "created_at": now.isoformat(),
        "last_used_at": None,
    }
    await db.portal_tokens.insert_one(doc)
    logger.info("Portal token created for contact %s", contact["id"])
    return {"message": "If that email is registered, a link has been sent."}


@router.get(
    "/auth/verify/{token}",
    summary="Verify a portal token",
    responses={401: {"description": INVALID_TOKEN}},
)
async def verify_token(token: str):
    ctx = await validate_portal_token(token)
    return {
        "valid": True,
        "contact": ctx["contact"],
        "org": ctx["org"],
    }


# ── Partner Dashboard ─────────────────────────────────────────────────

@router.get("/dashboard", summary="Partner portal dashboard overview",
            responses={401: {"description": INVALID_TOKEN}})
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


# ── Partner Projects & Tasks ──────────────────────────────────────────

@router.get("/projects", summary="List projects for this partner org",
            responses={401: {"description": INVALID_TOKEN}})
async def portal_list_projects(ctx: PortalContext):
    projects = await db.projects.find(
        {"partner_org_id": ctx["partner_org_id"], "deleted_at": None}, {"_id": 0}
    ).sort("event_date", -1).to_list(100)
    return {"items": projects, "total": len(projects)}


@router.get(
    "/projects/{project_id}/tasks",
    summary="Partner's tasks for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_tasks(project_id: str, ctx: PortalContext):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

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
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

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
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
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
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
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
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)

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
    skip: int = 0, limit: int = 50,
):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    total = await db.task_comments.count_documents({"task_id": task_id})
    comments = await db.task_comments.find(
        {"task_id": task_id}, {"_id": 0},
    ).sort("created_at", 1).skip(skip).limit(limit).to_list(limit)
    return {"items": comments, "total": total, "skip": skip, "limit": limit}


@router.post(
    "/projects/{project_id}/tasks/{task_id}/comments",
    summary="Partner posts a task comment",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": TASK_NOT_FOUND}},
)
async def portal_post_task_comment(
    project_id: str, task_id: str, ctx: PortalContext,
    data: TaskCommentCreate,
):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
    )
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)

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
        "created_at": now,
    }
    await db.task_comments.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ── Partner Documents ─────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/documents",
    summary="Shared documents for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_documents(project_id: str, ctx: PortalContext):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    docs = await db.documents.find(
        {"project_id": project_id, "visibility": "shared"}, {"_id": 0}
    ).sort("uploaded_at", -1).to_list(200)
    return {"items": docs, "total": len(docs)}


@router.post(
    "/projects/{project_id}/documents",
    summary="Partner uploads a document",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_upload_document(
    project_id: str,
    ctx: PortalContext,
    file: Annotated[UploadFile, File(...)],
):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    doc_id = str(uuid.uuid4())
    stored_name = _safe_stored_name(doc_id, file.filename)
    file_path = os.path.join(UPLOAD_DIR, stored_name)
    await stream_upload_to_disk(file, file_path)

    ext = os.path.splitext(stored_name)[1]
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": doc_id,
        "project_id": project_id,
        "partner_org_id": ctx["partner_org_id"],
        "filename": file.filename,
        "file_type": ext.lstrip(".") if ext else "unknown",
        "file_path": stored_name,
        "visibility": "shared",
        "uploaded_by": ctx["contact"]["name"],
        "uploaded_at": now,
        "version": 1,
    }
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get(
    "/projects/{project_id}/documents/{doc_id}/download",
    summary="Partner downloads a shared document",
    responses={
        401: {"description": INVALID_TOKEN},
        404: {"description": "Document not found"},
    },
)
async def portal_download_document(project_id: str, doc_id: str, ctx: PortalContext):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    doc = await db.documents.find_one(
        {"id": doc_id, "project_id": project_id, "visibility": "shared"}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    stored = os.path.basename(doc.get("file_path", ""))
    file_path = os.path.join(UPLOAD_DIR, stored)
    if not stored or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(file_path, filename=doc.get("filename", "download"))


# ── Partner Messages ──────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/messages",
    summary="Messages for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_messages(
    project_id: str, ctx: PortalContext,
    channel: Optional[str] = None, skip: int = 0, limit: int = 50,
):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    query = {"project_id": project_id, "visibility": {"$ne": "internal"}}
    if channel:
        query["channel"] = channel
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", 1).skip(skip).limit(limit).to_list(limit)
    total = await db.messages.count_documents(query)
    return {"items": messages, "total": total, "skip": skip, "limit": limit}


@router.post(
    "/projects/{project_id}/messages",
    summary="Partner sends a message",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_send_message(project_id: str, ctx: PortalContext, data: MessageCreate):
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": msg_id,
        "project_id": project_id,
        "channel": data.channel,
        "sender_type": "partner",
        "sender_name": ctx["contact"]["name"],
        "sender_id": ctx["contact"]["id"],
        "body": data.body,
        "visibility": "shared",  # Partner messages are always visible to both sides
        "created_at": now,
        "read_by": [ctx["contact"]["id"]],
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ── Org-Level Documents ───────────────────────────────────────────────

@router.get("/org-documents", summary="Org-level shared documents",
            responses={401: {"description": INVALID_TOKEN}})
async def portal_org_documents(ctx: PortalContext):
    docs = await db.documents.find(
        {
            "partner_org_id": ctx["partner_org_id"],
            "project_id": None,
            "visibility": "shared",
        },
        {"_id": 0},
    ).sort("uploaded_at", -1).to_list(200)
    return {"items": docs, "total": len(docs)}
