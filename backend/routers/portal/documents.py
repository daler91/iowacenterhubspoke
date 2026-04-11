"""Partner portal document endpoints — list, upload, download, org-level docs."""

import os
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from core.logger import get_logger
from core.portal_auth import PortalContext
from core.upload import stream_upload_to_disk
from database import db

from ._shared import (
    INVALID_TOKEN,
    PROJECT_NOT_FOUND,
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


@router.get(
    "/projects/{project_id}/documents",
    summary="Shared documents for a project",
    responses={401: {"description": INVALID_TOKEN}, 404: {"description": PROJECT_NOT_FOUND}},
)
async def portal_project_documents(project_id: str, ctx: PortalContext):
    await _require_partner_project(project_id, ctx)

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
    await _require_partner_project(project_id, ctx)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    doc_id = str(uuid.uuid4())
    stored_name = safe_stored_name(doc_id, file.filename)
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
    await _require_partner_project(project_id, ctx)

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


@router.get(
    "/org-documents",
    summary="Org-level shared documents",
    responses={401: {"description": INVALID_TOKEN}},
)
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
