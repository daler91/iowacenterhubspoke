import uuid
import os
import re
from datetime import datetime, timezone
from typing import Annotated, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import DocumentVisibilityUpdate
from core.upload import stream_upload_to_disk
from core.auth import CurrentUser, EditorRequired, SchedulerRequired
from services.activity import log_activity
from services.notification_events import notify_project_document_shared
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["project-docs"])

# See project_tasks.py for the rationale on env-var overrides.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR") or os.path.join(ROOT_DIR, "uploads")
DOC_NOT_FOUND = "Document not found"
PROJECT_NOT_FOUND = "Project not found"

# Only allow safe characters in file extensions
_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def _safe_stored_name(doc_id: str, original_filename: str | None) -> str:
    """Build a stored filename from a UUID and sanitized extension only."""
    ext = os.path.splitext(original_filename or "")[1]
    if not ext or not _SAFE_EXT_RE.match(ext):
        ext = ""
    return f"{doc_id}{ext}"


@router.get("", summary="List documents for a project")
async def list_documents(
    project_id: str,
    user: CurrentUser,
    visibility: Optional[str] = None,
):
    query = {"project_id": project_id, "deleted_at": None}
    if visibility:
        query["visibility"] = visibility
    docs = await db.documents.find(query, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    return {"items": docs, "total": len(docs)}


@router.post(
    "",
    summary="Upload a document",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def upload_document(
    project_id: str,
    user: EditorRequired,
    file: Annotated[UploadFile, File(...)],
    visibility: Annotated[str, Form()] = "shared",
):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
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
        "partner_org_id": project.get("partner_org_id"),
        "filename": file.filename,
        "file_type": ext.lstrip(".") if ext else "unknown",
        "file_path": stored_name,
        "visibility": visibility if visibility in ("internal", "shared") else "shared",
        "uploaded_by": user.get("name", "System"),
        "uploaded_at": now,
        "version": 1,
        "deleted_at": None,
    }
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(
        "document_uploaded", f"Document '{file.filename}' uploaded",
        "document", doc_id, user.get("name", "System"),
    )
    await notify_project_document_shared(doc, project, user)
    return doc


@router.patch(
    "/{doc_id}/visibility",
    summary="Toggle document visibility",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def update_visibility(
    project_id: str, doc_id: str,
    data: DocumentVisibilityUpdate, user: EditorRequired,
):
    result = await db.documents.update_one(
        {"id": doc_id, "project_id": project_id, "deleted_at": None},
        {"$set": {"visibility": data.visibility}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    updated = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    return updated


@router.delete(
    "/{doc_id}",
    summary="Delete a document",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def delete_document(project_id: str, doc_id: str, user: SchedulerRequired):
    # Soft-delete keeps the audit record; the file on disk stays until an
    # admin-triggered purge so a mistaken delete can be recovered.
    doc = await db.documents.find_one(
        {"id": doc_id, "project_id": project_id, "deleted_at": None}
    )
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    now = datetime.now(timezone.utc).isoformat()
    await db.documents.update_one(
        {"id": doc_id}, {"$set": {"deleted_at": now}}
    )
    await log_activity(
        "document_deleted", f"Document '{doc.get('filename')}' deleted",
        "document", doc_id, user.get("name", "System"),
    )
    return {"message": "Document deleted"}


@router.get(
    "/{doc_id}/download",
    summary="Download a document",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def download_document(project_id: str, doc_id: str, user: CurrentUser):
    doc = await db.documents.find_one(
        {"id": doc_id, "project_id": project_id, "deleted_at": None},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    stored = os.path.basename(doc.get("file_path", ""))
    file_path = os.path.join(UPLOAD_DIR, stored)
    if not stored or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(file_path, filename=doc.get("filename", "download"))
