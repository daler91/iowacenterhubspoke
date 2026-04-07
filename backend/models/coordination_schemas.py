from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal


# ── Projects ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    title: str
    class_type: Literal["workshop", "series", "office_hours", "onboarding"]
    partner_org_id: str
    event_date: str  # ISO datetime string
    community: str
    venue_name: str
    template_id: Optional[str] = None
    schedule_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    event_date: Optional[str] = None
    phase: Optional[Literal["planning", "promotion", "delivery", "follow_up", "complete"]] = None
    community: Optional[str] = None
    venue_name: Optional[str] = None
    registration_count: Optional[int] = None
    attendance_count: Optional[int] = None
    warm_leads: Optional[int] = None
    notes: Optional[str] = None


# ── Tasks ─────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str
    phase: Literal["planning", "promotion", "delivery", "follow_up"]
    owner: Literal["internal", "partner", "both"]
    due_date: str  # ISO datetime string
    details: Optional[str] = ""
    assigned_to: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    phase: Optional[Literal["planning", "promotion", "delivery", "follow_up"]] = None
    owner: Optional[Literal["internal", "partner", "both"]] = None
    due_date: Optional[str] = None
    details: Optional[str] = None
    assigned_to: Optional[str] = None
    sort_order: Optional[int] = None


class TaskReorder(BaseModel):
    task_ids: List[str]


# ── Partner Orgs ──────────────────────────────────────────────────────

class VenueDetails(BaseModel):
    capacity: Optional[int] = None
    av_setup: Optional[str] = ""
    wifi: Optional[bool] = None
    parking: Optional[str] = ""
    accessibility: Optional[str] = ""
    signage: Optional[str] = ""


class PartnerOrgCreate(BaseModel):
    name: str
    community: str
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = ""
    status: Literal["prospect", "onboarding", "active", "inactive"] = "prospect"
    notes: Optional[str] = ""


class PartnerOrgUpdate(BaseModel):
    name: Optional[str] = None
    community: Optional[str] = None
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = None
    status: Optional[Literal["prospect", "onboarding", "active", "inactive"]] = None
    notes: Optional[str] = None


# ── Partner Contacts ──────────────────────────────────────────────────

class PartnerContactCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    role: Optional[str] = ""
    is_primary: bool = False


class PartnerContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    is_primary: Optional[bool] = None


# ── Documents ─────────────────────────────────────────────────────────

class DocumentVisibilityUpdate(BaseModel):
    visibility: Literal["internal", "shared"]


# ── Messages ──────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    channel: str
    body: str


# ── Portal Auth ───────────────────────────────────────────────────────

class PortalAuthRequest(BaseModel):
    email: EmailStr
