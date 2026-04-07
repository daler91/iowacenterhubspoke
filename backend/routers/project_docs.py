import uuid
import os
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from database import db, ROOT_DIR
from models.coordination_schemas import DocumentVisibilityUpdate
from core.auth import CurrentUser
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["project-docs"])

UPLOAD_DIR = os.path.join(ROOT_DIR, "uploads")
DOC_NOT_FOUND = "Document not found"


@router.get("", summary="List documents for a project")
async def list_documents(
    project_id: str,
    user: CurrentUser,
    visibility: Optional[str] = None,
):
    query = {"project_id": project_id}
    if visibility:
        query["visibility"] = visibility
    docs = await db.documents.find(query, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    return {"items": docs, "total": len(docs)}


@router.post("", summary="Upload a document")
async def upload_document(
    project_id: str,
    user: CurrentUser,
    file: UploadFile = File(...),
    visibility: str = Form("shared"),
):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
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
        "partner_org_id": project.get("partner_org_id"),
        "filename": file.filename,
        "file_type": ext.lstrip(".") if ext else "unknown",
        "file_path": stored_name,
        "visibility": visibility if visibility in ("internal", "shared") else "shared",
        "uploaded_by": user.get("name", "System"),
        "uploaded_at": now,
        "version": 1,
    }
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(
        "document_uploaded", f"Document '{file.filename}' uploaded",
        "document", doc_id, user.get("name", "System"),
    )
    return doc


@router.patch("/{doc_id}/visibility", summary="Toggle document visibility")
async def update_visibility(
    project_id: str, doc_id: str,
    data: DocumentVisibilityUpdate, user: CurrentUser,
):
    result = await db.documents.update_one(
        {"id": doc_id, "project_id": project_id},
        {"$set": {"visibility": data.visibility}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    updated = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    return updated


@router.delete("/{doc_id}", summary="Delete a document")
async def delete_document(project_id: str, doc_id: str, user: CurrentUser):
    doc = await db.documents.find_one({"id": doc_id, "project_id": project_id})
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    # Remove file from disk
    file_path = os.path.join(UPLOAD_DIR, doc.get("file_path", ""))
    if os.path.exists(file_path):
        os.remove(file_path)
    await db.documents.delete_one({"id": doc_id})
    await log_activity(
        "document_deleted", f"Document '{doc.get('filename')}' deleted",
        "document", doc_id, user.get("name", "System"),
    )
    return {"message": "Document deleted"}


@router.get("/{doc_id}/download", summary="Download a document")
async def download_document(project_id: str, doc_id: str, user: CurrentUser):
    doc = await db.documents.find_one(
        {"id": doc_id, "project_id": project_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail=DOC_NOT_FOUND)
    file_path = os.path.join(UPLOAD_DIR, doc.get("file_path", ""))
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(file_path, filename=doc.get("filename", "download"))
