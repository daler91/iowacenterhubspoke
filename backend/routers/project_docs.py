import uuid
import os
import re
from datetime import datetime, timezone
from typing import Annotated, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.params import Depends, Query
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import DocumentVisibilityUpdate
from core.upload import stream_upload_to_disk
from core.auth import CurrentUser, EditorRequired, SchedulerRequired
from core.pagination import PaginationParams, paginated_response
from core.repository import SoftDeleteRepository
from services.activity import log_activity
from services.notification_events import notify_project_document_shared
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["project-docs"])
documents_repo = SoftDeleteRepository(db, "documents")
projects_repo = SoftDeleteRepository(db, "projects")

# See project_tasks.py for the rationale on env-var overrides.
UPLOAD_DIR = os.environ.get("UPLOAD_DIR") or os.path.join(ROOT_DIR, "uploads")
DOC_NOT_FOUND = "Document not found"
PROJECT_NOT_FOUND = "Project not found"

# Only allow safe characters in file extensions
_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def _project_docs_pagination(
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=500),
) -> PaginationParams:
    """Preserve legacy default/max page size (500) for this endpoint."""
    return PaginationParams(skip=skip, limit=limit)


ProjectDocsPaginated = Annotated[PaginationParams, Depends(_project_docs_pagination)]


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
    pagination: ProjectDocsPaginated,
    visibility: Optional[str] = None,
):
    query = {"project_id": project_id}
    if visibility:
        query["visibility"] = visibility
    items, total = await documents_repo.paginate(
        query,
        pagination,
        sort=[("uploaded_at", -1)],
    )
    return paginated_response(items, total, pagination)


@router.post(
    "",
    summary="Upload a document",
    responses={
        404: {"description": PROJECT_NOT_FOUND},
        413: {"description": "File too large (max 10MB)"},
    },
)
async def upload_document(
    project_id: str,
    user: EditorRequired,
    file: Annotated[UploadFile, File(...)],
    visibility: Annotated[str, Form()] = "shared",
):
    project = await projects_repo.get_by_id(project_id)
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
    doc = await documents_repo.find_one_active({"id": doc_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    if doc.get("visibility") != data.visibility:
        updated_ok = await documents_repo.update_active(
            doc_id, {"visibility": data.visibility}
        )
        if not updated_ok:
            raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    updated = await documents_repo.find_one_active({"id": doc_id, "project_id": project_id})
    return updated


@router.delete(
    "/{doc_id}",
    summary="Delete a document",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def delete_document(project_id: str, doc_id: str, user: SchedulerRequired):
    # Soft-delete keeps the audit record; the file on disk stays until an
    # admin-triggered purge so a mistaken delete can be recovered.
    doc = await documents_repo.find_one_active({"id": doc_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    await documents_repo.soft_delete(doc_id, user.get("name", "System"))
    await log_activity(
        "document_deleted", f"Document '{doc.get('filename')}' deleted",
        "document", doc_id, user.get("name", "System"),
    )
    return {"message": "Document deleted"}


@router.post(
    "/{doc_id}/restore",
    summary="Restore a document",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def restore_document(project_id: str, doc_id: str, user: SchedulerRequired):
    doc = await documents_repo.collection.find_one(
        {"id": doc_id, "project_id": project_id, "deleted_at": {"$ne": None}}
    )
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    restored = await documents_repo.restore(doc_id)
    if not restored:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    return {"message": "Document restored"}


@router.get(
    "/{doc_id}/download",
    summary="Download a document",
    responses={404: {"description": DOC_NOT_FOUND}},
)
async def download_document(
    project_id: str, doc_id: str, user: CurrentUser,
    inline: bool = False,
):
    doc = await documents_repo.find_one_active({"id": doc_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    stored = os.path.basename(doc.get("file_path", ""))
    file_path = os.path.join(UPLOAD_DIR, stored)
    if not stored or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        file_path,
        filename=doc.get("filename", "download"),
        content_disposition_type="inline" if inline else "attachment",
    )
