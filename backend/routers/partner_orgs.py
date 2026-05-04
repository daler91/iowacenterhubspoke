import uuid
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import (
    PartnerOrgCreate, PartnerOrgUpdate,
    PartnerContactCreate, PartnerContactUpdate,
)
from core.auth import CurrentUser, AdminRequired, SchedulerRequired
from core.pagination import Paginated, paginated_response
from core.repository import SoftDeleteRepository
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/partner-orgs", tags=["partner-orgs"])
partner_orgs_repo = SoftDeleteRepository(db, "partner_orgs")
partner_contacts_repo = SoftDeleteRepository(db, "partner_contacts")
projects_repo = SoftDeleteRepository(db, "projects")
tasks_repo = SoftDeleteRepository(db, "tasks")

ORG_NOT_FOUND = "Partner organization not found"
CONTACT_NOT_FOUND = "Contact not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


@router.get("", summary="List partner organizations")
async def list_partner_orgs(
    user: CurrentUser,
    pagination: Paginated,
    community: Optional[str] = None,
    status: Optional[str] = None,
):
    query = {}
    if community:
        query["community"] = community
    if status:
        query["status"] = status
    items, total = await partner_orgs_repo.paginate(query, pagination)
    return paginated_response(items, total, pagination)


@router.post("", summary="Create a partner organization")
async def create_partner_org(data: PartnerOrgCreate, user: SchedulerRequired):
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
    summary="Get partner organization core details",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def get_partner_org(org_id: str, user: CurrentUser):
    """Return the partner organization doc only.

    Contacts and recent projects are served via their own endpoints
    (``/{org_id}/contacts`` and ``/{org_id}/projects``) so the profile
    page can render core org details without waiting for the two list
    queries, and so mutations to one list don't force a full refetch
    of the others.
    """
    org = await partner_orgs_repo.get_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    return org


async def _validate_status_transition(org_id: str, org: dict, new_status: str) -> None:
    """Check business rules for partner status transitions. Raises 422 if blocked."""
    current_status = org.get("status", "prospect")
    if new_status == current_status:
        return

    contacts = await partner_contacts_repo.count_active({"partner_org_id": org_id})
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
async def update_partner_org(org_id: str, data: PartnerOrgUpdate, user: SchedulerRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)

    new_status = update_data.get("status")
    if new_status:
        org = await partner_orgs_repo.get_by_id(org_id)
        if not org:
            raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
        await _validate_status_transition(org_id, org, new_status)

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    updated_ok = await partner_orgs_repo.update_active(org_id, update_data)
    if not updated_ok:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    updated = await partner_orgs_repo.get_by_id(org_id)
    return updated


@router.delete(
    "/{org_id}",
    summary="Soft-delete partner organization",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def delete_partner_org(org_id: str, user: AdminRequired):
    deleted = await partner_orgs_repo.soft_delete(org_id, user.get("name", "System"))
    if not deleted:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    await log_activity(
        "partner_org_deleted", f"Partner org '{org_id}' deleted",
        "partner_org", org_id, user.get("name", "System"),
    )
    return {"message": "Partner organization deleted"}


@router.post(
    "/{org_id}/restore",
    summary="Restore partner organization",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def restore_partner_org(org_id: str, user: AdminRequired):
    restored = await partner_orgs_repo.restore(org_id)
    if not restored:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    return {"message": "Partner organization restored"}


# ── Projects ──────────────────────────────────────────────────────────


@router.get(
    "/{org_id}/projects",
    summary="List recent projects for a partner org",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def list_org_projects(
    org_id: str, user: CurrentUser, limit: int = 20,
):
    """Return the N most recent projects for this partner org.

    Split off from ``GET /partner-orgs/{id}`` so the profile page can
    render core org details without waiting for the project history
    query, and so mutations elsewhere don't force a refetch of this
    list. Caller-supplied ``limit`` is clamped to [1, 100].
    """
    limit = max(1, min(limit, 100))
    org = await partner_orgs_repo.get_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    projects = await projects_repo.find_active(
        {"partner_org_id": org_id},
        sort=[("event_date", -1)],
        limit=limit,
    )
    total = await projects_repo.count_active({"partner_org_id": org_id})
    return {"items": projects, "total": total}


# ── Contacts ──────────────────────────────────────────────────────────


@router.get(
    "/{org_id}/contacts",
    summary="List contacts for a partner org",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def list_contacts(org_id: str, user: CurrentUser):
    org = await partner_orgs_repo.get_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    contacts = await partner_contacts_repo.find_active({"partner_org_id": org_id}, limit=200)
    total = await partner_contacts_repo.count_active({"partner_org_id": org_id})
    return {"items": contacts, "total": total}


@router.post(
    "/{org_id}/contacts",
    summary="Add a contact to a partner org",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def create_contact(org_id: str, data: PartnerContactCreate, user: SchedulerRequired):
    org = await partner_orgs_repo.get_by_id(org_id)
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
async def update_contact(org_id: str, contact_id: str, data: PartnerContactUpdate, user: SchedulerRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    contact = await partner_contacts_repo.find_one_active(
        {"id": contact_id, "partner_org_id": org_id},
    )
    if not contact:
        raise HTTPException(status_code=404, detail=CONTACT_NOT_FOUND)
    await partner_contacts_repo.update_active(contact_id, update_data)
    updated = await partner_contacts_repo.find_one_active(
        {"id": contact_id, "partner_org_id": org_id},
    )
    return updated


@router.post(
    "/{org_id}/contacts/{contact_id}/invite",
    summary="Send portal invite to a partner contact",
    responses={404: {"description": CONTACT_NOT_FOUND}},
)
async def send_portal_invite(org_id: str, contact_id: str, user: SchedulerRequired):
    """Generate a magic link token and email it to the partner contact."""
    from services.email import (
        resolve_app_url,
        send_portal_invite as send_invite_email,
    )

    # Keep direct collection reads here (instead of module-level repository
    # singletons) so tests can monkeypatch `partner_orgs.db` with async mocks
    # and still exercise this function in isolation.
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)

    contact = await db.partner_contacts.find_one(
        {"id": contact_id, "partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    )
    if not contact:
        raise HTTPException(status_code=404, detail=CONTACT_NOT_FOUND)

    # Validate email-link configuration before persisting a live token. If
    # production APP_URL is missing or malformed, retries must not accumulate
    # orphaned portal credentials.
    app_url = resolve_app_url()

    # Generate magic link token
    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=7)

    await db.portal_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "contact_id": contact_id,
        "token": token,
        "expires_at": expires,
        "created_at": now.isoformat(),
        "last_used_at": None,
    })

    # Build portal URL
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
        "message": "Portal invite sent" if sent else "Invite created (email delivery pending)"
    }


# ── Health Score ──────────────────────────────────────────────────────


@router.get(
    "/{org_id}/health",
    summary="Partner health score",
    responses={404: {"description": ORG_NOT_FOUND}},
)
async def get_partner_health(org_id: str, user: CurrentUser):
    org = await partner_orgs_repo.get_by_id(org_id)
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)

    projects = await projects_repo.find_active({"partner_org_id": org_id}, limit=500)
    project_ids = [p["id"] for p in projects]

    total_tasks = 0
    completed_tasks = 0
    last_active = None

    if project_ids:
        tasks = await tasks_repo.find_active({"project_id": {"$in": project_ids}}, limit=5000)
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
