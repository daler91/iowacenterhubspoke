import uuid
import secrets
import os
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import (
    PartnerOrgCreate, PartnerOrgUpdate,
    PartnerContactCreate, PartnerContactUpdate,
)
from core.auth import CurrentUser, AdminRequired
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/partner-orgs", tags=["partner-orgs"])

ORG_NOT_FOUND = "Partner organization not found"
CONTACT_NOT_FOUND = "Contact not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


@router.get("", summary="List partner organizations")
async def list_partner_orgs(
    user: CurrentUser,
    community: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    query = {"deleted_at": None}
    if community:
        query["community"] = community
    if status:
        query["status"] = status
    total = await db.partner_orgs.count_documents(query)
    items = await db.partner_orgs.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.post("", summary="Create a partner organization")
async def create_partner_org(data: PartnerOrgCreate, user: CurrentUser):
    org_id = str(uuid.uuid4())
    doc = {
        "id": org_id,
        "name": data.name,
        "community": data.community,
        "location_id": data.location_id,
        "venue_details": data.venue_details.model_dump() if data.venue_details else {},
        "co_branding": data.co_branding or "",
        "status": data.status,
        "notes": data.notes or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.partner_orgs.insert_one(doc)
    doc.pop("_id", None)
    logger.info("Partner org created", extra={"entity": {"partner_org_id": org_id}})
    await log_activity(
        "partner_org_created",
        f"Partner org '{data.name}' created in {data.community}",
        "partner_org", org_id, user.get("name", "System"),
    )
    return doc


@router.get(
    "/{org_id}",
    summary="Get partner organization with contacts and history",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def get_partner_org(org_id: str, user: CurrentUser):
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    contacts = await db.partner_contacts.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).to_list(200)
    projects = await db.projects.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).sort("event_date", -1).to_list(50)
    org["contacts"] = contacts
    org["projects"] = projects
    return org


async def _validate_status_transition(org_id: str, org: dict, new_status: str) -> None:
    """Check business rules for partner status transitions. Raises 422 if blocked."""
    current_status = org.get("status", "prospect")
    if new_status == current_status:
        return

    contacts = await db.partner_contacts.count_documents(
        {"partner_org_id": org_id, "deleted_at": None}
    )
    venue = org.get("venue_details", {})
    has_venue = bool(venue.get("capacity") or venue.get("av_setup"))

    blockers = []
    if new_status == "onboarding" and current_status == "prospect" and contacts == 0:
        blockers.append("At least 1 contact is required to begin onboarding")
    elif new_status == "active":
        if contacts == 0:
            blockers.append("At least 1 contact is required")
        if not has_venue:
            blockers.append("Venue details (capacity or AV setup) must be provided")

    if blockers:
        raise HTTPException(
            status_code=422,
            detail={"message": "Status transition blocked", "blockers": blockers},
        )


@router.put(
    "/{org_id}",
    summary="Update partner organization",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": ORG_NOT_FOUND},
        422: {"description": "Status transition blocked by missing requirements"},
    },
)
async def update_partner_org(org_id: str, data: PartnerOrgUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    new_status = update_data.get("status")
    if new_status:
        org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None}, {"_id": 0})
        if not org:
            raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
        await _validate_status_transition(org_id, org, new_status)

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.partner_orgs.update_one({"id": org_id, "deleted_at": None}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    updated = await db.partner_orgs.find_one({"id": org_id}, {"_id": 0})
    return updated


@router.delete(
    "/{org_id}",
    summary="Soft-delete partner organization",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def delete_partner_org(org_id: str, user: AdminRequired):
    result = await db.partner_orgs.update_one(
        {"id": org_id, "deleted_at": None},
        {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    await log_activity(
        "partner_org_deleted", f"Partner org '{org_id}' deleted",
        "partner_org", org_id, user.get("name", "System"),
    )
    return {"message": "Partner organization deleted"}


# ── Contacts ──────────────────────────────────────────────────────────


@router.get(
    "/{org_id}/contacts",
    summary="List contacts for a partner org",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def list_contacts(org_id: str, user: CurrentUser):
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    contacts = await db.partner_contacts.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).to_list(200)
    return {"items": contacts, "total": len(contacts)}


@router.post(
    "/{org_id}/contacts",
    summary="Add a contact to a partner org",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def create_contact(org_id: str, data: PartnerContactCreate, user: CurrentUser):
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    contact_id = str(uuid.uuid4())
    doc = {
        "id": contact_id,
        "partner_org_id": org_id,
        "name": data.name,
        "email": data.email,
        "phone": data.phone or "",
        "role": data.role or "",
        "is_primary": data.is_primary,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "deleted_at": None,
    }
    await db.partner_contacts.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(
        "contact_created",
        f"Contact '{data.name}' added to partner org",
        "partner_contact", contact_id, user.get("name", "System"),
    )
    return doc


@router.put(
    "/{org_id}/contacts/{contact_id}",
    summary="Update a contact",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": CONTACT_NOT_FOUND},
    },
)
async def update_contact(org_id: str, contact_id: str, data: PartnerContactUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.partner_contacts.update_one(
        {"id": contact_id, "partner_org_id": org_id, "deleted_at": None},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=CONTACT_NOT_FOUND)
    updated = await db.partner_contacts.find_one({"id": contact_id}, {"_id": 0})
    return updated


@router.post(
    "/{org_id}/contacts/{contact_id}/invite",
    summary="Send portal invite to a partner contact",
    responses={404: {"description": CONTACT_NOT_FOUND}},
)
async def send_portal_invite(org_id: str, contact_id: str, user: CurrentUser):
    """Generate a magic link token and email it to the partner contact."""
    from services.email import send_portal_invite as send_invite_email

    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)

    contact = await db.partner_contacts.find_one(
        {"id": contact_id, "partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    )
    if not contact:
        raise HTTPException(status_code=404, detail=CONTACT_NOT_FOUND)

    # Generate magic link token
    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)

    await db.portal_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "contact_id": contact_id,
        "token": token,
        "expires_at": expires.isoformat(),
        "created_at": now.isoformat(),
        "last_used_at": None,
    })

    # Build portal URL
    app_url = os.getenv("APP_URL", os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")[0].strip())
    portal_url = f"{app_url}/portal/{token}"

    # Send email
    sent = await send_invite_email(
        to=contact["email"],
        contact_name=contact["name"],
        org_name=org["name"],
        portal_url=portal_url,
    )

    await log_activity(
        "portal_invite_sent",
        f"Portal invite sent to {contact['name']} ({contact['email']})",
        "partner_contact", contact_id, user.get("name", "System"),
    )

    return {
        "message": "Portal invite sent" if sent else "Invite created (email delivery pending)",
        "portal_url": portal_url,
    }


# ── Health Score ──────────────────────────────────────────────────────


@router.get(
    "/{org_id}/health",
    summary="Partner health score",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def get_partner_health(org_id: str, user: CurrentUser):
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)

    projects = await db.projects.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).to_list(500)
    project_ids = [p["id"] for p in projects]

    total_tasks = 0
    completed_tasks = 0
    last_active = None

    if project_ids:
        tasks = await db.tasks.find(
            {"project_id": {"$in": project_ids}}, {"_id": 0}
        ).to_list(5000)
        total_tasks = len(tasks)
        completed_tasks = sum(1 for t in tasks if t.get("completed"))
        completed_dates = [t["completed_at"] for t in tasks if t.get("completed_at")]
        if completed_dates:
            last_active = max(completed_dates)

    if not last_active and projects:
        dates = [p.get("updated_at") or p.get("created_at") for p in projects]
        if dates:
            last_active = max(d for d in dates if d)

    completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0
    classes_hosted = sum(1 for p in projects if p.get("phase") == "complete")

    return {
        "partner_org_id": org_id,
        "name": org["name"],
        "total_projects": len(projects),
        "classes_hosted": classes_hosted,
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "completion_rate": round(completion_rate, 1),
        "last_active": last_active,
    }
