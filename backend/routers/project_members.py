"""Project members endpoint — source of truth for @-mention autocomplete.

Returns the union of internal teammates (approved admin/editor/scheduler
users) and the project's partner primary contacts. Matches the recipient
set used by :func:`services.notification_prefs.principals_for_project` so
"who you can @" and "who gets notified" stay consistent.
"""

from fastapi import APIRouter, HTTPException

from core.auth import CurrentUser
from database import db
from services.notification_prefs import (
    principal_to_member_dict,
    principals_for_project,
)


router = APIRouter(prefix="/projects/{project_id}/members", tags=["projects"])

PROJECT_NOT_FOUND = "Project not found"


@router.get("", summary="List members mentionable on this project")
async def list_project_members(project_id: str, user: CurrentUser):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None},
        {"_id": 0, "id": 1, "partner_org_id": 1},
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    principals = await principals_for_project(
        project_id=project_id,
        partner_org_id=project.get("partner_org_id"),
    )
    items = [principal_to_member_dict(p) for p in principals if p.id]
    return {"items": items, "total": len(items)}
