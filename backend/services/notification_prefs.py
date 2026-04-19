"""Notification preferences resolver.

Principals
----------
Both internal users (``db.users``) and partner contacts
(``db.partner_contacts``) can receive notifications. We call the recipient
a "principal" and carry their kind (``internal`` | ``partner``), id, email,
and raw prefs doc through the pipeline.

Stored shape
------------
Embedded on the principal document:

.. code-block:: python

    notification_preferences = {
        "version": 1,
        "digest": {"daily_hour": 8, "weekly_day": "mon"},
        "types": {
            "task.overdue": {"in_app": "instant", "email": "daily"},
            # only overrides; missing keys/channels fall back to registry
        },
    }

``get_frequency`` is the single function feature code should call to decide
whether to send on a given channel.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional

from core.notification_types import (
    Channel,
    Frequency,
    VALID_CHANNELS,
    VALID_FREQUENCIES,
    NOTIFICATION_TYPES,
    default_frequency,
    get_type,
)
from database import db


PrincipalKind = Literal["internal", "partner"]

PREFS_FIELD = "notification_preferences"
PREFS_VERSION = 1

DEFAULT_DIGEST = {"daily_hour": 8, "weekly_day": "mon"}
VALID_WEEKDAYS = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}


@dataclass
class Principal:
    """A recipient of notifications."""

    kind: PrincipalKind
    id: str
    email: Optional[str]
    name: Optional[str]
    role: Optional[str]  # internal role; None for partners
    prefs: dict  # raw stored prefs (may be empty)


# ── Loading ────────────────────────────────────────────────────────────

def _collection_for(kind: PrincipalKind):
    return db.users if kind == "internal" else db.partner_contacts


async def load_principal(kind: PrincipalKind, principal_id: str) -> Optional[Principal]:
    """Load a principal by kind + id. Returns ``None`` if not found."""
    doc = await _collection_for(kind).find_one(
        {"id": principal_id, "deleted_at": None}, {"_id": 0},
    ) if kind == "partner" else await db.users.find_one(
        {"id": principal_id}, {"_id": 0, "password_hash": 0},
    )
    if not doc:
        return None
    return _principal_from_doc(kind, doc)


async def find_principal_by_email(email: str) -> Optional[Principal]:
    """Find a principal by email (internal first, then partner)."""
    if not email:
        return None
    user = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    if user:
        return _principal_from_doc("internal", user)
    contact = await db.partner_contacts.find_one(
        {"email": email, "deleted_at": None}, {"_id": 0},
    )
    if contact:
        return _principal_from_doc("partner", contact)
    return None


def _principal_from_doc(kind: PrincipalKind, doc: dict) -> Principal:
    return Principal(
        kind=kind,
        id=doc.get("id") or "",
        email=doc.get("email"),
        name=doc.get("name"),
        role=doc.get("role") if kind == "internal" else None,
        prefs=doc.get(PREFS_FIELD) or {},
    )


# ── Batch recipient helpers (used by notification_events) ─────────────

async def list_admin_principals() -> list[Principal]:
    """Return every active admin user as a Principal.

    Used by ``admin.*`` events to fan out to the admin team.
    """
    cursor = db.users.find(
        {"role": "admin", "status": "approved"},
        {"_id": 0, "password_hash": 0},
    )
    docs = await cursor.to_list(length=500)
    return [_principal_from_doc("internal", d) for d in docs]


async def principal_for_employee(employee_id: str) -> Optional[Principal]:
    """Resolve the internal user linked to an ``employees`` record by email.

    Schedules carry ``employee_ids``, not ``user_ids``. Employees have an
    ``email`` field that may match a ``users`` record; this helper bridges
    the two collections. Returns ``None`` if the employee has no email or
    the email doesn't match any user.
    """
    if not employee_id:
        return None
    employee = await db.employees.find_one(
        {"id": employee_id, "deleted_at": None},
        {"_id": 0, "email": 1},
    )
    if not employee or not employee.get("email"):
        return None
    return await find_principal_by_email(employee["email"])


def principal_to_member_dict(p: Principal) -> dict:
    """Serialize a ``Principal`` for the ``GET /projects/{id}/members``
    response (and the portal equivalent). Shared so both endpoints project
    the same shape without duplicating the dict literal."""
    return {
        "id": p.id,
        "name": p.name or "Unknown",
        "kind": p.kind,
        "email": p.email,
    }


def principal_to_mention_dict(p: Principal) -> dict:
    """Serialize a ``Principal`` for the ``mentions`` array stored alongside
    a comment / message document."""
    return {"id": p.id, "kind": p.kind, "name": p.name or ""}


async def resolve_mention_principals(
    project_id: str,
    refs: list[dict],
    *,
    partner_org_id: Optional[str] = None,
) -> list[Principal]:
    """Resolve a list of ``{id, kind}`` mention refs against the project's
    member set.

    Unknown IDs (no longer a member, wrong kind, soft-deleted contact, etc.)
    are silently dropped — callers should not treat stale client-side state
    as a hard error. The returned list preserves the input order and
    deduplicates by (kind, id).
    """
    if not refs:
        return []
    members = await principals_for_project(
        project_id=project_id, partner_org_id=partner_org_id,
    )
    index: dict[tuple[str, str], Principal] = {
        (m.kind, m.id): m for m in members
    }
    out: list[Principal] = []
    seen: set[tuple[str, str]] = set()
    for r in refs:
        key = (r.get("kind") or "", r.get("id") or "")
        if key in seen or key[0] not in {"internal", "partner"} or not key[1]:
            continue
        principal = index.get(key)
        if principal is None:
            continue
        out.append(principal)
        seen.add(key)
    return out


async def prepare_mentions(
    project_id: str,
    refs_input: Optional[list],
    *,
    partner_org_id: Optional[str] = None,
) -> tuple[list[Principal], list[dict]]:
    """One-shot helper used by every POST-comment / POST-message route.

    Accepts ``data.mentions`` from a Pydantic request body — a list of
    ``MentionRef`` instances — and returns
    ``(resolved_principals, stored_mention_dicts)`` ready to persist on the
    document and hand to the mention notifier.
    """
    refs = [r.model_dump() for r in (refs_input or [])]
    mentioned = await resolve_mention_principals(
        project_id=project_id,
        refs=refs,
        partner_org_id=partner_org_id,
    )
    stored = [principal_to_mention_dict(p) for p in mentioned]
    return mentioned, stored


async def principals_for_project(
    project_id: str,
    exclude_ids: Optional[set[str]] = None,
    *,
    partner_org_id: Optional[str] = None,
) -> list[Principal]:
    """Return every stakeholder for a project (internal + partner contacts).

    Today we fan out to:

    - The partner org's **primary** contacts (matches the pattern used by
      ``services.task_reminders._partner_principals_for``).
    - Every admin-approved internal user who has ``notification_preferences``
      set — a narrower fan-out would require a project-membership table we
      don't have yet. For now, every non-viewer user is eligible; in
      practice the preferences UI lets them silence per-project event types
      they don't care about.

    ``exclude_ids`` is a set of principal IDs to drop (typically the actor
    so a user doesn't notify themselves).

    ``partner_org_id`` bypasses the DB lookup for the project — callers that
    already have the project document, OR that want to notify stakeholders
    of a just-soft-deleted project (where the ``deleted_at: None`` filter
    would return nothing), should pass it explicitly.
    """
    exclude_ids = exclude_ids or set()

    if partner_org_id is None:
        project = await db.projects.find_one(
            {"id": project_id, "deleted_at": None},
            {"_id": 0, "partner_org_id": 1},
        )
        if not project:
            return []
        partner_org_id = project.get("partner_org_id")

    principals: list[Principal] = []

    # Partner primary contacts
    if partner_org_id:
        contacts = await db.partner_contacts.find(
            {
                "partner_org_id": partner_org_id,
                "is_primary": True,
                "deleted_at": None,
            },
            {"_id": 0},
        ).to_list(10)
        for c in contacts:
            if c["id"] in exclude_ids or not c.get("email"):
                continue
            principals.append(_principal_from_doc("partner", c))

    # Internal stakeholders — every non-viewer, approved user. Preferences
    # let individuals silence categories they don't care about.
    users = await db.users.find(
        {
            "role": {"$in": ["admin", "editor", "scheduler"]},
            "status": "approved",
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(500)
    for u in users:
        if u["id"] in exclude_ids:
            continue
        principals.append(_principal_from_doc("internal", u))

    return principals


# ── Reading prefs ──────────────────────────────────────────────────────

def get_frequency(principal: Principal, type_key: str, channel: Channel) -> Frequency:
    """Return the effective frequency for a (type, channel).

    - Unknown / non-allowed channels return ``off``.
    - Types outside the principal's audience / role return ``off``.
    - Unknown type keys fall back to ``off`` (we never surprise-send).
    - Missing override returns the registry default.
    """
    t = get_type(type_key)
    if not t:
        return "off"
    if channel not in t.get("allowed_channels", set()):
        return "off"
    if principal.kind not in t.get("audience", set()):
        return "off"
    required = t.get("required_roles")
    if required and (principal.role is None or principal.role not in required):
        return "off"

    stored_types = (principal.prefs or {}).get("types") or {}
    stored = stored_types.get(type_key) or {}
    override = stored.get(channel)
    if override in VALID_FREQUENCIES:
        return override  # type: ignore[return-value]
    return default_frequency(type_key, channel)


def get_digest_settings(principal: Principal) -> dict:
    """Return {daily_hour, weekly_day} with defaults filled in."""
    d = (principal.prefs or {}).get("digest") or {}
    hour = d.get("daily_hour")
    weekday = d.get("weekly_day")
    return {
        "daily_hour": hour if isinstance(hour, int) and 0 <= hour <= 23 else DEFAULT_DIGEST["daily_hour"],
        "weekly_day": weekday if weekday in VALID_WEEKDAYS else DEFAULT_DIGEST["weekly_day"],
    }


# ── Effective view for API ─────────────────────────────────────────────

def get_effective_prefs(principal: Principal) -> dict:
    """Return the resolved preferences view used by the settings API.

    Every type visible to this principal is included, with every allowed
    channel populated (stored override OR registry default). Callers (the
    frontend) render this directly; no client-side merging needed.
    """
    types: dict[str, dict[str, str]] = {}
    for t in NOTIFICATION_TYPES.values():
        if t.get("transactional"):
            continue
        if principal.kind not in t.get("audience", set()):
            continue
        required = t.get("required_roles")
        if required and (principal.role is None or principal.role not in required):
            continue
        types[t["key"]] = {
            ch: get_frequency(principal, t["key"], ch)  # type: ignore[arg-type]
            for ch in t.get("allowed_channels", set())
        }
    return {
        "version": PREFS_VERSION,
        "digest": get_digest_settings(principal),
        "types": types,
    }


# ── Writing prefs ──────────────────────────────────────────────────────

def _sanitize_digest(raw_digest: dict) -> dict:
    """Clamp digest settings to valid values, falling back to defaults."""
    hour = raw_digest.get("daily_hour")
    weekday = raw_digest.get("weekly_day")
    return {
        "daily_hour": hour if isinstance(hour, int) and 0 <= hour <= 23 else DEFAULT_DIGEST["daily_hour"],
        "weekly_day": weekday if weekday in VALID_WEEKDAYS else DEFAULT_DIGEST["weekly_day"],
    }


def _sanitize_channel_freq(channel: str, freq: Any, allowed: set) -> Optional[str]:
    """Return the sanitised frequency for one (channel, freq) pair, or None."""
    if channel not in VALID_CHANNELS or channel not in allowed:
        return None
    if freq not in VALID_FREQUENCIES:
        return None
    # in_app has no digest cadence — coerce any digest value to instant.
    if channel == "in_app" and freq in ("daily", "weekly"):
        return "instant"
    return freq


def _sanitize_type_entry(type_key: str, channels_in: Any) -> dict[str, str]:
    """Return the sanitised per-channel map for one type, or {} to skip."""
    t = get_type(type_key)
    if not t or t.get("transactional") or not isinstance(channels_in, dict):
        return {}
    allowed = t.get("allowed_channels", set())
    cleaned: dict[str, str] = {}
    for ch, freq in channels_in.items():
        sanitized = _sanitize_channel_freq(ch, freq, allowed)
        if sanitized is not None:
            cleaned[ch] = sanitized
    return cleaned


def sanitize_update(raw: dict) -> dict:
    """Strip unknown keys / invalid values from an incoming prefs update.

    Unknown type keys and invalid frequencies are dropped rather than
    erroring out — forward-compatible with older frontends whose registry
    may be out-of-date.
    """
    sanitized_types: dict[str, dict[str, str]] = {}
    types_in = raw.get("types") or {}
    if isinstance(types_in, dict):
        for key, channels in types_in.items():
            cleaned = _sanitize_type_entry(key, channels)
            if cleaned:
                sanitized_types[key] = cleaned

    return {
        "version": PREFS_VERSION,
        "digest": _sanitize_digest(raw.get("digest") or {}),
        "types": sanitized_types,
    }


async def save_prefs(principal: Principal, sanitized: dict) -> dict:
    """Persist ``sanitized`` prefs onto the principal document.

    Returns the sanitized doc (useful for the API response).
    """
    coll = _collection_for(principal.kind)
    await coll.update_one(
        {"id": principal.id},
        {"$set": {PREFS_FIELD: sanitized}},
    )
    principal.prefs = sanitized
    return sanitized
