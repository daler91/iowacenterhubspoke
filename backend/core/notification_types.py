"""Notification type registry — single source of truth.

Adding a new user-facing notification is a matter of appending an entry
here. Every feature that emits a notification must go through
``services.notifications.dispatch`` which consults this registry (plus the
recipient's stored preferences) to decide whether to persist / email / skip.

Design principles
-----------------
- **Forward-compatible.** Unknown keys in a user's stored prefs are ignored;
  new keys added here get the registry default until the user changes them.
- **Transactional vs preference-driven.** Account-critical emails (password
  reset, account approved, user invite, portal invite, welcome-pending) are
  marked ``transactional=True`` — they are NOT shown in the settings UI and
  cannot be disabled.
- **Audience gating.** Each entry declares which audiences may receive it
  (``internal`` user, ``partner`` contact, or both). The preferences endpoint
  returns only the types visible to the caller's audience.
- **Role gating.** Admin-only items (e.g. "new user pending approval") set
  ``required_roles``. Non-admin internal users will not see those entries.

Frequencies
-----------
Each (type, channel) can be set to one of:

- ``instant`` — deliver immediately on dispatch
- ``daily``   — roll up into a daily digest email
- ``weekly``  — roll up into a weekly digest email
- ``off``     — skip

In-app notifications only honour ``instant`` and ``off`` (digests are an
email concept). The UI reflects this.
"""

from __future__ import annotations

from typing import Literal, Optional, TypedDict


Channel = Literal["in_app", "email"]
Frequency = Literal["instant", "daily", "weekly", "off"]
Audience = Literal["internal", "partner"]


class NotificationType(TypedDict, total=False):
    key: str
    category: str  # schedules | tasks | projects | account | admin | transactional
    label: str
    description: str
    default_channels: dict[Channel, Frequency]
    allowed_channels: set[Channel]
    audience: set[Audience]
    required_roles: Optional[set[str]]  # None means any role in the audience
    transactional: bool  # True => always on, hidden from UI
    implemented: bool  # informational: is this event currently wired up?


# Canonical ordering — categories, then types inside each category — is used
# by the API response so the frontend can render a stable layout.
CATEGORY_ORDER = [
    "schedules",
    "tasks",
    "projects",
    "account",
    "admin",
]

CATEGORY_LABELS = {
    "schedules": "Schedules & Classes",
    "tasks": "Tasks",
    "projects": "Projects & Coordination",
    "account": "Account",
    "admin": "Admin",
    "transactional": "Transactional (always on)",
}


NOTIFICATION_TYPES: dict[str, NotificationType] = {
    # ── Schedules & Classes ────────────────────────────────────────────
    "schedule.upcoming_today": {
        "key": "schedule.upcoming_today",
        "category": "schedules",
        "label": "Class starting today",
        "description": "A class you're assigned to is scheduled for today.",
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.town_to_town": {
        "key": "schedule.town_to_town",
        "category": "schedules",
        "label": "Town-to-town travel warning",
        "description": (
            "A schedule requires long travel between towns — verify the "
            "drive time fits."
        ),
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.idle_employee": {
        "key": "schedule.idle_employee",
        "category": "schedules",
        "label": "No classes today",
        "description": "You (or an employee you manage) have no classes scheduled today.",
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.assigned_to_you": {
        "key": "schedule.assigned_to_you",
        "category": "schedules",
        "label": "New schedule assigned",
        "description": "You have been added to a schedule.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.changed": {
        "key": "schedule.changed",
        "category": "schedules",
        "label": "Schedule cancelled or rescheduled",
        "description": "A schedule you're assigned to has been cancelled or moved.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.bulk_status_changed": {
        "key": "schedule.bulk_status_changed",
        "category": "schedules",
        "label": "Schedule status changed",
        "description": "A schedule you're on was marked in-progress or completed.",
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "schedule.bulk_location_changed": {
        "key": "schedule.bulk_location_changed",
        "category": "schedules",
        "label": "Schedule location changed",
        "description": "A schedule you're on was moved to a different location.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },

    # ── Tasks ──────────────────────────────────────────────────────────
    "task.approaching": {
        "key": "task.approaching",
        "category": "tasks",
        "label": "Task due soon",
        "description": "A task you own is due within 48 hours.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "task.overdue": {
        "key": "task.overdue",
        "category": "tasks",
        "label": "Task overdue",
        "description": "A task you own is past its due date.",
        "default_channels": {"in_app": "instant", "email": "daily"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "task.assigned_to_you": {
        "key": "task.assigned_to_you",
        "category": "tasks",
        "label": "Task assigned to you",
        "description": "A new task has been assigned to you.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "task.completed": {
        "key": "task.completed",
        "category": "tasks",
        "label": "Task completed",
        "description": "A task you own or follow has been marked complete.",
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "task.comment_added": {
        "key": "task.comment_added",
        "category": "tasks",
        "label": "New comment on a task",
        "description": "Someone commented on a task you own or follow.",
        "default_channels": {"in_app": "instant", "email": "daily"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "task.deleted": {
        "key": "task.deleted",
        "category": "tasks",
        "label": "Task removed",
        "description": "A task you owned or followed has been deleted.",
        "default_channels": {"in_app": "instant", "email": "off"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },

    # ── Projects & Coordination ────────────────────────────────────────
    "project.phase_advanced": {
        "key": "project.phase_advanced",
        "category": "projects",
        "label": "Project phase advanced",
        "description": "A project you're part of moved to the next phase.",
        "default_channels": {"in_app": "instant", "email": "daily"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "project.message_posted": {
        "key": "project.message_posted",
        "category": "projects",
        "label": "New message in a project",
        "description": "A new message was posted in a project you're part of.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "project.document_shared": {
        "key": "project.document_shared",
        "category": "projects",
        "label": "Document shared",
        "description": "A document was shared with your organization.",
        "default_channels": {"in_app": "instant", "email": "daily"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },
    "project.deleted": {
        "key": "project.deleted",
        "category": "projects",
        "label": "Project removed",
        "description": "A project you're part of has been deleted.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal", "partner"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },

    # ── Account ────────────────────────────────────────────────────────
    "account.role_changed": {
        "key": "account.role_changed",
        "category": "account",
        "label": "Your role changed",
        "description": "An administrator changed your role.",
        "default_channels": {"in_app": "instant", "email": "instant"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": False,
        "implemented": True,
    },

    # ── Admin-only ─────────────────────────────────────────────────────
    "admin.new_user_pending": {
        "key": "admin.new_user_pending",
        "category": "admin",
        "label": "New user awaiting approval",
        "description": "Someone registered and is waiting for admin approval.",
        "default_channels": {"in_app": "instant", "email": "daily"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": {"admin"},
        "transactional": False,
        "implemented": True,
    },
    "admin.partner_activity_digest": {
        "key": "admin.partner_activity_digest",
        "category": "admin",
        "label": "Partner activity digest",
        "description": "Roll-up of partner portal activity.",
        "default_channels": {"in_app": "off", "email": "weekly"},
        "allowed_channels": {"in_app", "email"},
        "audience": {"internal"},
        "required_roles": {"admin"},
        "transactional": False,
        "implemented": False,
    },

    # ── Transactional — always on, hidden from UI ──────────────────────
    "transactional.password_reset": {
        "key": "transactional.password_reset",
        "category": "transactional",
        "label": "Password reset",
        "description": "Password reset link.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
    "transactional.account_approved": {
        "key": "transactional.account_approved",
        "category": "transactional",
        "label": "Account approved",
        "description": "Your account has been approved.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
    "transactional.account_rejected": {
        "key": "transactional.account_rejected",
        "category": "transactional",
        "label": "Account rejected",
        "description": "Your registration request was declined.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
    "transactional.user_invite": {
        "key": "transactional.user_invite",
        "category": "transactional",
        "label": "User invitation",
        "description": "You've been invited to join the hub.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
    "transactional.portal_invite": {
        "key": "transactional.portal_invite",
        "category": "transactional",
        "label": "Portal invitation",
        "description": "Magic link for the partner portal.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"partner"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
    "transactional.welcome_pending": {
        "key": "transactional.welcome_pending",
        "category": "transactional",
        "label": "Registration acknowledgement",
        "description": "Your registration is pending admin approval.",
        "default_channels": {"email": "instant"},
        "allowed_channels": {"email"},
        "audience": {"internal"},
        "required_roles": None,
        "transactional": True,
        "implemented": True,
    },
}


# ── Helpers ────────────────────────────────────────────────────────────

VALID_FREQUENCIES: set[Frequency] = {"instant", "daily", "weekly", "off"}
VALID_CHANNELS: set[Channel] = {"in_app", "email"}


def get_type(key: str) -> Optional[NotificationType]:
    """Return the registry entry for ``key`` or ``None`` if unknown."""
    return NOTIFICATION_TYPES.get(key)


def is_valid_type(key: str) -> bool:
    return key in NOTIFICATION_TYPES


def _is_visible_to(t: NotificationType, audience: Audience, role: Optional[str]) -> bool:
    """True if ``t`` should be shown in the settings UI for this caller."""
    if t.get("transactional"):
        return False
    if audience not in t["audience"]:
        return False
    required = t.get("required_roles")
    if required and (role is None or role not in required):
        return False
    return True


def visible_types_for(audience: Audience, role: Optional[str]) -> list[NotificationType]:
    """Return registry entries the UI should render for a given caller.

    Excludes transactional entries (never shown) and entries outside the
    caller's audience or required-role set. Result is ordered by
    ``CATEGORY_ORDER`` then dict-insertion order within each category.
    """
    visible = [t for t in NOTIFICATION_TYPES.values() if _is_visible_to(t, audience, role)]
    category_rank = {cat: idx for idx, cat in enumerate(CATEGORY_ORDER)}
    return sorted(visible, key=lambda t: category_rank.get(t["category"], len(CATEGORY_ORDER)))


def default_frequency(type_key: str, channel: Channel) -> Frequency:
    """Registry default for (type, channel), or ``off`` if unknown/disallowed."""
    t = NOTIFICATION_TYPES.get(type_key)
    if not t:
        return "off"
    if channel not in t.get("allowed_channels", set()):
        return "off"
    return t["default_channels"].get(channel, "off")


def serialize_type_for_api(t: NotificationType) -> dict:
    """Convert a registry entry into a JSON-friendly dict for the API."""
    return {
        "key": t["key"],
        "category": t["category"],
        "label": t["label"],
        "description": t["description"],
        "default_channels": dict(t["default_channels"]),
        "allowed_channels": sorted(t["allowed_channels"]),
        "implemented": t.get("implemented", True),
    }
