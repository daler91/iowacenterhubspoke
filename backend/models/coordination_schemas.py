from pydantic import BaseModel, EmailStr, Field, model_validator
from typing import Optional, List, Literal

# Defensive caps — same rationale as models/schemas.py.
_MAX_NAME = 500
_MAX_DESCRIPTION = 5000
_MAX_NOTES = 5000
_MAX_MESSAGE_BODY = 20000


# ── Projects ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    title: str = Field(..., max_length=_MAX_NAME)
    event_format: Literal["workshop", "series", "office_hours", "onboarding"]
    partner_org_id: str
    event_date: str  # ISO datetime string
    community: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    venue_name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    template_id: Optional[str] = None
    schedule_id: Optional[str] = None
    class_id: Optional[str] = None
    # Auto-schedule creation fields
    employee_ids: Optional[List[str]] = None
    start_time: Optional[str] = None  # HH:MM
    end_time: Optional[str] = None  # HH:MM
    auto_create_schedule: bool = False

    @model_validator(mode="after")
    def _require_fields_for_auto_schedule(self):
        """Auto-created schedules need a concrete employee list + time window.

        Without this guard, ``auto_create_schedule=True`` paired with
        ``employee_ids=[]`` (or missing start/end times) produces a malformed
        schedule document downstream.
        """
        if not self.auto_create_schedule:
            return self
        if not self.employee_ids:
            raise ValueError(
                "auto_create_schedule=true requires a non-empty employee_ids list"
            )
        if not self.start_time or not self.end_time:
            raise ValueError(
                "auto_create_schedule=true requires both start_time and end_time"
            )
        return self


class PhaseAdvanceRequest(BaseModel):
    force: bool = False  # bypass incomplete task warning


class ProjectUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    event_format: Optional[Literal[
        "workshop", "series", "office_hours", "onboarding"
    ]] = None
    partner_org_id: Optional[str] = None
    class_id: Optional[str] = None
    event_date: Optional[str] = None
    phase: Optional[Literal[
        "planning", "promotion", "delivery", "follow_up", "complete"
    ]] = None
    community: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    venue_name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    registration_count: Optional[int] = None
    attendance_count: Optional[int] = None
    warm_leads: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


# ── Tasks ─────────────────────────────────────────────────────────────

TASK_STATUSES = ("to_do", "in_progress", "completed", "on_hold")


class TaskCreate(BaseModel):
    title: str = Field(..., max_length=_MAX_NAME)
    phase: Literal["planning", "promotion", "delivery", "follow_up"]
    owner: Literal["internal", "partner", "both"]
    due_date: str  # ISO datetime string
    details: Optional[str] = Field(default="", max_length=_MAX_DESCRIPTION)
    description: Optional[str] = Field(default="", max_length=_MAX_DESCRIPTION)
    assigned_to: Optional[str] = None
    status: Optional[Literal["to_do", "in_progress", "completed", "on_hold"]] = "to_do"


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    phase: Optional[Literal[
        "planning", "promotion", "delivery", "follow_up"
    ]] = None
    owner: Optional[Literal["internal", "partner", "both"]] = None
    due_date: Optional[str] = None
    details: Optional[str] = Field(default=None, max_length=_MAX_DESCRIPTION)
    description: Optional[str] = Field(default=None, max_length=_MAX_DESCRIPTION)
    assigned_to: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[Literal["to_do", "in_progress", "completed", "on_hold"]] = None
    spotlight: Optional[bool] = None
    at_risk: Optional[bool] = None


class TaskReorder(BaseModel):
    task_ids: List[str]


class TaskCommentCreate(BaseModel):
    body: str = Field(..., max_length=_MAX_MESSAGE_BODY)
    parent_comment_id: Optional[str] = None


# ── Partner Orgs ──────────────────────────────────────────────────────

class VenueDetails(BaseModel):
    capacity: Optional[int] = None
    av_setup: Optional[str] = ""
    wifi: Optional[bool] = None
    parking: Optional[str] = ""
    accessibility: Optional[str] = ""
    signage: Optional[str] = ""


class PartnerOrgCreate(BaseModel):
    name: str = Field(..., max_length=_MAX_NAME)
    community: str = Field(..., max_length=_MAX_NAME)
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = Field(default="", max_length=_MAX_DESCRIPTION)
    status: Literal[
        "prospect", "onboarding", "active", "inactive"
    ] = "prospect"
    notes: Optional[str] = Field(default="", max_length=_MAX_NOTES)


class PartnerOrgUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    community: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = Field(default=None, max_length=_MAX_DESCRIPTION)
    status: Optional[Literal[
        "prospect", "onboarding", "active", "inactive"
    ]] = None
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


# ── Partner Contacts ──────────────────────────────────────────────────

class PartnerContactCreate(BaseModel):
    name: str = Field(..., max_length=_MAX_NAME)
    email: EmailStr
    phone: Optional[str] = Field(default="", max_length=50)
    role: Optional[str] = Field(default="", max_length=_MAX_NAME)
    is_primary: bool = False


class PartnerContactUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    email: Optional[str] = Field(default=None, max_length=320)
    phone: Optional[str] = Field(default=None, max_length=50)
    role: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    is_primary: Optional[bool] = None


# ── Documents ─────────────────────────────────────────────────────────

class DocumentVisibilityUpdate(BaseModel):
    visibility: Literal["internal", "shared"]


# ── Messages ──────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    channel: str = Field(..., max_length=_MAX_NAME)
    body: str = Field(..., max_length=_MAX_MESSAGE_BODY)
    visibility: Literal["internal", "shared"] = "shared"


# ── Portal Auth ───────────────────────────────────────────────────────

class PortalAuthRequest(BaseModel):
    email: EmailStr


# ── Event Outcomes (Phase 2) ──────────────────────────────────────────

class OutcomeCreate(BaseModel):
    attendee_name: str = Field(..., max_length=_MAX_NAME)
    attendee_email: Optional[str] = Field(default=None, max_length=320)
    attendee_phone: Optional[str] = Field(default=None, max_length=50)
    status: Literal[
        "attended", "contacted", "consultation", "converted", "lost"
    ] = "attended"
    notes: Optional[str] = Field(default="", max_length=_MAX_NOTES)


class OutcomeUpdate(BaseModel):
    attendee_name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    attendee_email: Optional[str] = Field(default=None, max_length=320)
    attendee_phone: Optional[str] = Field(default=None, max_length=50)
    status: Optional[Literal[
        "attended", "contacted", "consultation", "converted", "lost"
    ]] = None
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    contacted_at: Optional[str] = None
    consultation_at: Optional[str] = None
    converted_at: Optional[str] = None
    force: Optional[bool] = None  # bypass backward transition warning


class OutcomeBulkCreate(BaseModel):
    attendees: List[OutcomeCreate]


# ── Promotion Checklist (Phase 2) ─────────────────────────────────────

class PromotionChecklistItemCreate(BaseModel):
    channel: str = Field(..., max_length=_MAX_NAME)
    label: str = Field(..., max_length=_MAX_NAME)
    owner: Literal["internal", "partner", "both"] = "both"
    due_date: Optional[str] = None
    notes: Optional[str] = Field(default="", max_length=_MAX_NOTES)


class PromotionChecklistItemToggle(BaseModel):
    side: Literal["internal", "partner"]


# ── Webhooks (Phase 2) ────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    url: str
    events: List[str]
    active: bool = True


class WebhookUpdate(BaseModel):
    url: Optional[str] = None
    events: Optional[List[str]] = None
    active: Optional[bool] = None
