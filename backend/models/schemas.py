from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator
from typing import List, Literal, Optional
from core.constants import DEFAULT_EMPLOYEE_COLOR, DEFAULT_CLASS_COLOR, END_MODE_NEVER

# Format patterns shared by ScheduleCreate / ScheduleUpdate /
# ScheduleRelocate. Centralised so a future date- or time-format
# change (e.g. adding seconds) happens in one place — and so
# SonarCloud stops flagging the duplicate literals.
ISO_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
HH_MM_TIME_PATTERN = r"^\d{2}:\d{2}$"

# Defensive caps: unbounded free-text fields enable cheap disk/memory DOS
# (a 10 MB notes value hits Mongo + every downstream notification payload).
# These limits are generous for real user content but shut the door on
# abuse.
_MAX_NAME = 500
_MAX_DESCRIPTION = 5000
_MAX_NOTES = 5000


class UserRegister(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=256)
    invite_token: Optional[str] = None
    privacy_policy_accepted: bool = Field(
        False,
        description=(
            "Must be true for self-service registration. The app shares data "
            "with Google (Calendar + Distance Matrix) and Microsoft (Outlook) "
            "when an employee opts into those integrations; accepting this "
            "flag confirms the user has seen the privacy notice."
        ),
    )

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, v):
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        return v


class UserLogin(BaseModel):
    email: str
    password: str = Field(..., max_length=256)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)


class LocationCreate(BaseModel):
    city_name: str = Field(..., min_length=1, max_length=120)
    drive_time_minutes: int = Field(..., ge=0, le=1440)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class LocationUpdate(BaseModel):
    city_name: Optional[str] = Field(None, min_length=1, max_length=120)
    drive_time_minutes: Optional[int] = Field(None, ge=0, le=1440)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=_MAX_NAME)
    email: Optional[str] = Field(default=None, max_length=320)
    phone: Optional[str] = Field(default=None, max_length=50)
    color: Optional[str] = DEFAULT_EMPLOYEE_COLOR


class EmployeeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=_MAX_NAME)
    email: Optional[str] = Field(default=None, max_length=320)
    phone: Optional[str] = Field(default=None, max_length=50)
    color: Optional[str] = None


class RecurrenceRule(BaseModel):
    interval: int = 1
    frequency: str  # week, month
    weekdays: Optional[List[int]] = None  # 0=Sun ... 6=Sat
    end_mode: Optional[str] = END_MODE_NEVER  # never, on_date, after_occurrences
    end_date: Optional[str] = None
    occurrences: Optional[int] = None


class ClassCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=_MAX_NAME)
    description: Optional[str] = Field(default=None, max_length=_MAX_DESCRIPTION)
    color: Optional[str] = DEFAULT_CLASS_COLOR


class ClassUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=_MAX_NAME)
    description: Optional[str] = Field(default=None, max_length=_MAX_DESCRIPTION)
    color: Optional[str] = None


class ScheduleCreate(BaseModel):
    employee_id: Optional[str] = None  # backward compat: single employee
    employee_ids: Optional[List[str]] = Field(None, max_length=50)  # preferred: multiple employees
    location_id: str
    class_id: Optional[str] = None
    date: str = Field(..., pattern=ISO_DATE_PATTERN)
    start_time: str = Field(..., pattern=HH_MM_TIME_PATTERN)
    end_time: str = Field(..., pattern=HH_MM_TIME_PATTERN)
    force: Optional[bool] = False
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    drive_to_override_minutes: Optional[int] = Field(None, ge=0, le=1440)  # override drive TO this class
    drive_from_override_minutes: Optional[int] = Field(None, ge=0, le=1440)  # override drive FROM this class
    schedule_id: Optional[str] = None  # ID of schedule being edited (for conflict check)
    series_id: Optional[str] = None  # ID of recurrence series (set automatically for recurring schedules)
    recurrence: Optional[str] = None  # none, weekly, biweekly
    recurrence_end_date: Optional[str] = None  # YYYY-MM-DD
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = Field(None, ge=1, le=520)
    custom_recurrence: Optional[RecurrenceRule] = None
    force_outlook: Optional[bool] = False
    force_google: Optional[bool] = False
    # Idempotency key: supply a unique UUID per user submission so retrying
    # the same request does not create duplicate schedules.
    idempotency_key: Optional[str] = Field(None, max_length=128)

    @model_validator(mode="after")
    def _validate_time_range(self):
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self

    @model_validator(mode="after")
    def _normalise_employees(self):
        """Ensure employee_ids is always a non-empty list."""
        if self.employee_ids:
            if not self.employee_id:
                self.employee_id = self.employee_ids[0]
        elif self.employee_id:
            self.employee_ids = [self.employee_id]
        else:
            raise ValueError("Either employee_id or employee_ids is required")
        return self


class ScheduleUpdate(BaseModel):
    employee_ids: Optional[List[str]] = Field(None, max_length=50)
    employee_id: Optional[str] = None  # backward compat: sets single employee
    location_id: Optional[str] = None
    class_id: Optional[str] = None
    # Mirror ScheduleCreate's format patterns. The DST guard in
    # ``validate_local_time_exists`` only detects semantic non-existence
    # (02:30 on spring-forward); a bogus string like "garbage" is
    # syntactically rejected, not semantically. Without the pattern
    # filter here, PATCH /schedules/{id} with a bad time persists and
    # later blows up downstream ``time_to_minutes`` calls.
    date: Optional[str] = Field(None, pattern=ISO_DATE_PATTERN)
    start_time: Optional[str] = Field(None, pattern=HH_MM_TIME_PATTERN)
    end_time: Optional[str] = Field(None, pattern=HH_MM_TIME_PATTERN)
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    drive_to_override_minutes: Optional[int] = Field(None, ge=0, le=1440)  # override drive TO this class
    drive_from_override_minutes: Optional[int] = Field(None, ge=0, le=1440)  # override drive FROM this class
    status: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_end_date: Optional[str] = None
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = Field(None, ge=1, le=520)
    custom_recurrence: Optional[RecurrenceRule] = None
    series_id: Optional[str] = None
    # Optimistic concurrency: when provided, update only succeeds if the
    # current document's version matches. Prevents silent overwrites on
    # concurrent edits.
    expected_version: Optional[int] = Field(None, ge=0)


class StatusUpdate(BaseModel):
    status: Literal["upcoming", "in_progress", "completed"]


class ScheduleRelocate(BaseModel):
    # Same format constraints as ScheduleCreate so the relocate handler's
    # DST guard doesn't silently accept a malformed time.
    date: str = Field(..., pattern=ISO_DATE_PATTERN)
    start_time: str = Field(..., pattern=HH_MM_TIME_PATTERN)
    end_time: str = Field(..., pattern=HH_MM_TIME_PATTERN)
    force: Optional[bool] = False


class BulkDeleteRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)


class BulkStatusUpdateRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    status: str  # upcoming, in_progress, completed


class BulkReassignRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    employee_ids: List[str]  # set these employees on all selected schedules
    force: bool = False  # bypass conflict check preview


class BulkLocationUpdateRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    location_id: str
    force: bool = False  # bypass conflict check preview


class BulkClassUpdateRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    class_id: str


class UserRoleUpdate(BaseModel):
    role: Literal["admin", "editor", "scheduler", "viewer"]


class InviteCreate(BaseModel):
    email: EmailStr
    name: Optional[str] = Field(default=None, max_length=_MAX_NAME)
    role: str


class PasswordChange(BaseModel):
    current_password: str = Field(..., max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)


class ErrorResponse(BaseModel):
    detail: str
    code: str
    errors: Optional[list] = None


class ScheduleImportItem(BaseModel):
    employee_ids: List[str] = Field(..., max_length=50)
    location_id: str
    class_id: Optional[str] = None
    date: str
    start_time: str
    end_time: str
    force: Optional[bool] = False
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    row_idx: int


# ── Notification preferences ───────────────────────────────────────────
#
# Stored shape lives on the principal document (user or partner contact).
# Incoming updates are validated loosely — unknown type keys are sanitized
# out by ``services.notification_prefs.sanitize_update`` rather than 422'd,
# so a stale frontend doesn't break the endpoint.


class NotificationDigestSettings(BaseModel):
    daily_hour: Optional[int] = Field(default=None, ge=0, le=23)
    weekly_day: Optional[
        Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    ] = None


class NotificationPreferencesUpdate(BaseModel):
    """Request body for updating a principal's notification preferences.

    ``types`` is a free-form mapping of ``type_key -> {channel -> freq}``.
    Validation of keys/channels/frequencies happens in
    ``services.notification_prefs.sanitize_update`` so that unknown keys
    from an older/newer client are silently ignored rather than rejected.
    """

    digest: Optional[NotificationDigestSettings] = None
    types: Optional[dict] = None
