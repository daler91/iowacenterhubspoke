import uuid
import secrets
import os
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import PortalAuthRequest, MessageCreate
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])

UPLOAD_DIR = os.path.join(ROOT_DIR, "uploads")
TOKEN_EXPIRY_DAYS = 7


# ── Portal Token Auth ─────────────────────────────────────────────────

async def get_portal_context(token: str):
    """Validate a portal token and return the contact + org context."""
    token_doc = await db.portal_tokens.find_one({"token": token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=401, detail="Invalid or expired portal link")
    if token_doc.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Portal link has expired")

    contact = await db.partner_contacts.find_one(
        {"id": token_doc["contact_id"], "deleted_at": None}, {"_id": 0}
    )
    if not contact:
        raise HTTPException(status_code=401, detail="Contact not found")

    org = await db.partner_orgs.find_one(
        {"id": contact["partner_org_id"], "deleted_at": None}, {"_id": 0}
    )
    if not org:
        raise HTTPException(status_code=401, detail="Partner organization not found")

    # Update last_used_at
    await db.portal_tokens.update_one(
        {"token": token},
        {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}},
    )

    return {"contact": contact, "org": org, "partner_org_id": org["id"]}


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
    # In Phase 2, send email here. For now, return the token directly.
    logger.info("Portal token created for contact %s", contact["id"])
    return {"message": "If that email is registered, a link has been sent.", "token": token}


@router.get("/auth/verify/{token}", summary="Verify a portal token")
async def verify_token(token: str):
    ctx = await get_portal_context(token)
    return {
        "valid": True,
        "contact": ctx["contact"],
        "org": ctx["org"],
    }


# ── Partner Dashboard ─────────────────────────────────────────────────

@router.get("/dashboard", summary="Partner portal dashboard overview")
async def portal_dashboard(token: str):
    ctx = await get_portal_context(token)
    org_id = ctx["partner_org_id"]

    projects = await db.projects.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).sort("event_date", 1).to_list(100)

    project_ids = [p["id"] for p in projects]
    upcoming = [p for p in projects if p.get("phase") != "complete"]
    completed_count = sum(1 for p in projects if p.get("phase") == "complete")

    # Get partner tasks
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

@router.get("/projects", summary="List projects for this partner org")
async def portal_list_projects(token: str):
    ctx = await get_portal_context(token)
    projects = await db.projects.find(
        {"partner_org_id": ctx["partner_org_id"], "deleted_at": None}, {"_id": 0}
    ).sort("event_date", -1).to_list(100)
    return {"items": projects, "total": len(projects)}


@router.get("/projects/{project_id}/tasks", summary="Partner's tasks for a project")
async def portal_project_tasks(project_id: str, token: str):
    ctx = await get_portal_context(token)
    # Verify project belongs to this org
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = await db.tasks.find(
        {"project_id": project_id, "owner": {"$in": ["partner", "both"]}},
        {"_id": 0},
    ).sort("sort_order", 1).to_list(500)
    return {"items": tasks, "total": len(tasks)}


@router.patch("/projects/{project_id}/tasks/{task_id}/complete", summary="Partner completes a task")
async def portal_complete_task(project_id: str, task_id: str, token: str):
    ctx = await get_portal_context(token)
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    task = await db.tasks.find_one(
        {"id": task_id, "project_id": project_id, "owner": {"$in": ["partner", "both"]}},
        {"_id": 0},
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

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


# ── Partner Documents ─────────────────────────────────────────────────

@router.get("/projects/{project_id}/documents", summary="Shared documents for a project")
async def portal_project_documents(project_id: str, token: str):
    ctx = await get_portal_context(token)
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    docs = await db.documents.find(
        {"project_id": project_id, "visibility": "shared"}, {"_id": 0}
    ).sort("uploaded_at", -1).to_list(200)
    return {"items": docs, "total": len(docs)}


@router.post("/projects/{project_id}/documents", summary="Partner uploads a document")
async def portal_upload_document(
    project_id: str,
    token: str,
    file: UploadFile = File(...),
):
    ctx = await get_portal_context(token)
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    doc_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{doc_id}{ext}"
    file_path = os.path.join(UPLOAD_DIR, stored_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

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


# ── Partner Messages ──────────────────────────────────────────────────

@router.get("/projects/{project_id}/messages", summary="Messages for a project")
async def portal_project_messages(
    project_id: str, token: str,
    channel: Optional[str] = None, skip: int = 0, limit: int = 50,
):
    ctx = await get_portal_context(token)
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    query = {"project_id": project_id}
    if channel:
        query["channel"] = channel
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", 1).skip(skip).limit(limit).to_list(limit)
    total = await db.messages.count_documents(query)
    return {"items": messages, "total": total, "skip": skip, "limit": limit}


@router.post("/projects/{project_id}/messages", summary="Partner sends a message")
async def portal_send_message(project_id: str, token: str, data: MessageCreate):
    ctx = await get_portal_context(token)
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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
        "created_at": now,
        "read_by": [ctx["contact"]["id"]],
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ── Org-Level Documents ───────────────────────────────────────────────

@router.get("/org-documents", summary="Org-level shared documents")
async def portal_org_documents(token: str):
    ctx = await get_portal_context(token)
    docs = await db.documents.find(
        {
            "partner_org_id": ctx["partner_org_id"],
            "project_id": None,
            "visibility": "shared",
        },
        {"_id": 0},
    ).sort("uploaded_at", -1).to_list(200)
    return {"items": docs, "total": len(docs)}
