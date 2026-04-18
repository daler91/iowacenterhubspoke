from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Optional, List, Literal

# Defensive caps — same rationale as models/schemas.py.
_MAX_NAME = 500
_MAX_DESCRIPTION = 5000
_MAX_NOTES = 5000
_MAX_MESSAGE_BODY = 20000


def _validate_event_date(value: str) -> str:
    """Accept ISO date or ISO datetime strings only — surface a 400 instead
    of silently falling back to 'now' when tasks are cloned from a template."""
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as e:
        raise ValueError(
            "event_date must be an ISO date (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:MM:SS)"
        ) from e
    return value


# ── Projects ──────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    event_format: Literal["workshop", "series", "office_hours", "onboarding"]
    partner_org_id: str
    event_date: str  # ISO date or datetime string
    community: Optional[str] = Field(None, max_length=120)
    venue_name: Optional[str] = Field(None, max_length=200)
    template_id: Optional[str] = None
    schedule_id: Optional[str] = None
    class_id: Optional[str] = None
    employee_ids: Optional[List[str]] = Field(None, max_length=50)
    start_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    end_time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")
    auto_create_schedule: bool = False

    @field_validator("event_date")
    @classmethod
    def _check_event_date(cls, v):
        return _validate_event_date(v)

    @model_validator(mode="after")
    def _require_fields_for_auto_schedule(self):  # NOSONAR(S3516)
        """Auto-created schedules need a concrete employee list + time window.

        Without this guard, ``auto_create_schedule=True`` paired with
        ``employee_ids=[]`` (or missing start/end times) produces a malformed
        schedule document downstream. Pydantic v2 ``mode="after"`` validators
        are required to return ``self`` on every non-raising path — the
        "always returns same value" warning is a false positive.
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
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    event_format: Optional[Literal[
        "workshop", "series", "office_hours", "onboarding"
    ]] = None
    partner_org_id: Optional[str] = None
    class_id: Optional[str] = None
    event_date: Optional[str] = None
    phase: Optional[Literal[
        "planning", "promotion", "delivery", "follow_up", "complete"
    ]] = None
    community: Optional[str] = Field(None, max_length=120)
    venue_name: Optional[str] = Field(None, max_length=200)
    registration_count: Optional[int] = Field(None, ge=0, le=1_000_000)
    attendance_count: Optional[int] = Field(None, ge=0, le=1_000_000)
    warm_leads: Optional[int] = Field(None, ge=0, le=1_000_000)
    notes: Optional[str] = Field(None, max_length=10_000)

    @field_validator("event_date")
    @classmethod
    def _check_event_date(cls, v):
        if v is None:
            return v
        return _validate_event_date(v)

    @model_validator(mode="after")
    def _warm_leads_bounded_by_attendance(self):
        if (
            self.warm_leads is not None
            and self.attendance_count is not None
            and self.warm_leads > self.attendance_count
        ):
            raise ValueError(
                "warm_leads cannot exceed attendance_count"
            )
        return self


# ── Tasks ─────────────────────────────────────────────────────────────

TASK_STATUSES = ("to_do", "in_progress", "completed", "on_hold")


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    phase: Literal["planning", "promotion", "delivery", "follow_up"]
    owner: Literal["internal", "partner", "both"]
    due_date: str  # ISO datetime string
    details: Optional[str] = Field("", max_length=10_000)
    description: Optional[str] = Field("", max_length=10_000)
    assigned_to: Optional[str] = None
    status: Optional[Literal["to_do", "in_progress", "completed", "on_hold"]] = "to_do"


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    phase: Optional[Literal[
        "planning", "promotion", "delivery", "follow_up"
    ]] = None
    owner: Optional[Literal["internal", "partner", "both"]] = None
    due_date: Optional[str] = None
    details: Optional[str] = Field(None, max_length=10_000)
    description: Optional[str] = Field(None, max_length=10_000)
    assigned_to: Optional[str] = None
    sort_order: Optional[int] = None
    status: Optional[Literal["to_do", "in_progress", "completed", "on_hold"]] = None
    spotlight: Optional[bool] = None
    at_risk: Optional[bool] = None


class TaskReorder(BaseModel):
    task_ids: List[str]


class TaskCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10_000)
    parent_comment_id: Optional[str] = None


# ── Partner Orgs ──────────────────────────────────────────────────────

class VenueDetails(BaseModel):
    capacity: Optional[int] = Field(None, ge=0, le=1_000_000)
    av_setup: Optional[str] = Field("", max_length=2000)
    wifi: Optional[bool] = None
    parking: Optional[str] = Field("", max_length=2000)
    accessibility: Optional[str] = Field("", max_length=2000)
    signage: Optional[str] = Field("", max_length=2000)


class PartnerOrgCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=300)
    community: str = Field(..., min_length=1, max_length=120)
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = Field("", max_length=2000)
    status: Literal[
        "prospect", "onboarding", "active", "inactive"
    ] = "prospect"
    notes: Optional[str] = Field("", max_length=10_000)


class PartnerOrgUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=300)
    community: Optional[str] = Field(None, min_length=1, max_length=120)
    location_id: Optional[str] = None
    venue_details: Optional[VenueDetails] = None
    co_branding: Optional[str] = Field(None, max_length=2000)
    status: Optional[Literal[
        "prospect", "onboarding", "active", "inactive"
    ]] = None
    notes: Optional[str] = Field(None, max_length=10_000)


# ── Partner Contacts ──────────────────────────────────────────────────

class PartnerContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    phone: Optional[str] = Field("", max_length=40)
    role: Optional[str] = Field("", max_length=120)
    is_primary: bool = False


class PartnerContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    email: Optional[str] = Field(None, max_length=320)
    phone: Optional[str] = Field(None, max_length=40)
    role: Optional[str] = Field(None, max_length=120)
    is_primary: Optional[bool] = None


# ── Documents ─────────────────────────────────────────────────────────

class DocumentVisibilityUpdate(BaseModel):
    visibility: Literal["internal", "shared"]


# ── Messages ──────────────────────────────────────────────────────────

class MessageCreate(BaseModel):
    channel: str = Field(..., min_length=1, max_length=120)
    body: str = Field(..., min_length=1, max_length=20_000)
    visibility: Literal["internal", "shared"] = "shared"


# ── Portal Auth ───────────────────────────────────────────────────────

class PortalAuthRequest(BaseModel):
    email: EmailStr


# ── Event Outcomes (Phase 2) ──────────────────────────────────────────

class OutcomeCreate(BaseModel):
    attendee_name: str = Field(..., min_length=1, max_length=200)
    attendee_email: Optional[str] = Field(None, max_length=320)
    attendee_phone: Optional[str] = Field(None, max_length=40)
    status: Literal[
        "attended", "contacted", "consultation", "converted", "lost"
    ] = "attended"
    notes: Optional[str] = Field("", max_length=5000)


class OutcomeUpdate(BaseModel):
    attendee_name: Optional[str] = Field(None, min_length=1, max_length=200)
    attendee_email: Optional[str] = Field(None, max_length=320)
    attendee_phone: Optional[str] = Field(None, max_length=40)
    status: Optional[Literal[
        "attended", "contacted", "consultation", "converted", "lost"
    ]] = None
    notes: Optional[str] = Field(None, max_length=5000)
    contacted_at: Optional[str] = None
    consultation_at: Optional[str] = None
    converted_at: Optional[str] = None
    force: Optional[bool] = None  # bypass backward transition warning


class OutcomeBulkCreate(BaseModel):
    attendees: List[OutcomeCreate] = Field(..., max_length=1000)


# ── Promotion Checklist (Phase 2) ─────────────────────────────────────

class PromotionChecklistItemCreate(BaseModel):
    channel: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=300)
    owner: Literal["internal", "partner", "both"] = "both"
    due_date: Optional[str] = None
    notes: Optional[str] = Field("", max_length=5000)


class PromotionChecklistItemToggle(BaseModel):
    side: Literal["internal", "partner"]


# ── Webhooks (Phase 2) ────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2000)
    events: List[str] = Field(..., max_length=50)
    active: bool = True


class WebhookUpdate(BaseModel):
    url: Optional[str] = Field(None, min_length=1, max_length=2000)
    events: Optional[List[str]] = Field(None, max_length=50)
    active: Optional[bool] = None
