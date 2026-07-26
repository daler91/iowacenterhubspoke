"""Constants and small helpers shared across the portal sub-routers."""

import os
import re

from fastapi import HTTPException

from core.portal_auth import INVALID_TOKEN
from core.upload import UPLOAD_DIR
from database import db

__all__ = [
    "INVALID_TOKEN",
    "UPLOAD_DIR",
    "PROJECT_NOT_FOUND",
    "TASK_NOT_FOUND",
    "safe_stored_name",
    "require_partner_project",
]

PROJECT_NOT_FOUND = "Project not found"
TASK_NOT_FOUND = "Task not found"

_SAFE_EXT_RE = re.compile(r"^\.[a-zA-Z0-9]{1,10}$")


def safe_stored_name(doc_id: str, original_filename: str | None) -> str:
    """Return a filesystem-safe name for an uploaded file.

    Keeps the original extension if it matches the allow-list (letters,
    digits, 1-10 chars); otherwise drops it. The bare ``doc_id`` is
    always usable as a path component because it is a UUID.
    """
    ext = os.path.splitext(original_filename or "")[1]
    if not ext or not _SAFE_EXT_RE.match(ext):
        ext = ""
    return f"{doc_id}{ext}"


async def require_partner_project(project_id: str, ctx: dict) -> dict:
    """Load a project scoped to the caller's partner org, or raise 404.

    This is the portal's tenant-isolation boundary: every partner-facing read
    or write of a project's child resources goes through it, and the
    ``partner_org_id`` filter is what stops one partner reaching another's
    data by guessing an id. It lives here, once, because three sub-routers
    previously carried byte-identical private copies — exactly the shape
    where a future fix lands in two of three and the third keeps leaking.
    """
    project = await db.projects.find_one(
        {"id": project_id, "partner_org_id": ctx["partner_org_id"], "deleted_at": None},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project
