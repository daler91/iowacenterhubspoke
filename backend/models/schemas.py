from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from core.constants import DEFAULT_EMPLOYEE_COLOR, DEFAULT_CLASS_COLOR, END_MODE_NEVER

class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(..., min_length=8)

class UserLogin(BaseModel):
    email: str
    password: str

class LocationCreate(BaseModel):
    city_name: str
    drive_time_minutes: int
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class LocationUpdate(BaseModel):
    city_name: Optional[str] = None
    drive_time_minutes: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    deleted_at: Optional[str] = None

class EmployeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    color: Optional[str] = DEFAULT_EMPLOYEE_COLOR

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    color: Optional[str] = None
    deleted_at: Optional[str] = None

class RecurrenceRule(BaseModel):
    interval: int = 1
    frequency: str  # week, month
    weekdays: Optional[List[int]] = None  # 0=Sun ... 6=Sat
    end_mode: Optional[str] = END_MODE_NEVER  # never, on_date, after_occurrences
    end_date: Optional[str] = None
    occurrences: Optional[int] = None

class ClassCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = DEFAULT_CLASS_COLOR

class ClassUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    deleted_at: Optional[str] = None

class ScheduleCreate(BaseModel):
    employee_id: str
    location_id: str
    class_id: Optional[str] = None
    date: str  # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str  # HH:MM
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None
    recurrence: Optional[str] = None  # none, weekly, biweekly
    recurrence_end_date: Optional[str] = None  # YYYY-MM-DD
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = None
    custom_recurrence: Optional[RecurrenceRule] = None

class ScheduleUpdate(BaseModel):
    employee_id: Optional[str] = None
    location_id: Optional[str] = None
    class_id: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    notes: Optional[str] = None
    travel_override_minutes: Optional[int] = None
    status: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_end_date: Optional[str] = None
    recurrence_end_mode: Optional[str] = None
    recurrence_occurrences: Optional[int] = None
    custom_recurrence: Optional[RecurrenceRule] = None
    deleted_at: Optional[str] = None

class StatusUpdate(BaseModel):
    status: str  # upcoming, in_progress, completed

class ScheduleRelocate(BaseModel):
    date: str
    start_time: str
    end_time: str

class BulkDeleteRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)

class BulkStatusUpdateRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    status: str  # upcoming, in_progress, completed

class BulkReassignRequest(BaseModel):
    ids: List[str] = Field(..., min_length=1, max_length=200)
    employee_id: str

class UserRoleUpdate(BaseModel):
    role: str

class ErrorResponse(BaseModel):
    detail: str
    code: str
    errors: Optional[list] = None
