import uuid
from datetime import datetime, timezone
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


@router.get("/{org_id}", summary="Get partner organization with contacts and history")
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


@router.put("/{org_id}", summary="Update partner organization")
async def update_partner_org(org_id: str, data: PartnerOrgUpdate, user: CurrentUser):
    update_data = {}
    for k, v in data.model_dump().items():
        if v is not None:
            if k == "venue_details":
                update_data[k] = v
            else:
                update_data[k] = v
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.partner_orgs.update_one({"id": org_id, "deleted_at": None}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    updated = await db.partner_orgs.find_one({"id": org_id}, {"_id": 0})
    return updated


@router.delete("/{org_id}", summary="Soft-delete partner organization")
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


@router.get("/{org_id}/contacts", summary="List contacts for a partner org")
async def list_contacts(org_id: str, user: CurrentUser):
    org = await db.partner_orgs.find_one({"id": org_id, "deleted_at": None})
    if not org:
        raise HTTPException(status_code=404, detail=ORG_NOT_FOUND)
    contacts = await db.partner_contacts.find(
        {"partner_org_id": org_id, "deleted_at": None}, {"_id": 0}
    ).to_list(200)
    return {"items": contacts, "total": len(contacts)}


@router.post("/{org_id}/contacts", summary="Add a contact to a partner org")
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


@router.put("/{org_id}/contacts/{contact_id}", summary="Update a contact")
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


# ── Health Score ──────────────────────────────────────────────────────


@router.get("/{org_id}/health", summary="Partner health score")
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
