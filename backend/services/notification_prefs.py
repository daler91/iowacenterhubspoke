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

def sanitize_update(raw: dict) -> dict:
    """Strip unknown keys / invalid values from an incoming prefs update.

    Unknown type keys and invalid frequencies are dropped rather than
    erroring out — forward-compatible with older frontends whose registry
    may be out-of-date.
    """
    out: dict[str, Any] = {"version": PREFS_VERSION}

    # digest
    digest_in = raw.get("digest") or {}
    hour = digest_in.get("daily_hour")
    weekday = digest_in.get("weekly_day")
    out["digest"] = {
        "daily_hour": hour if isinstance(hour, int) and 0 <= hour <= 23 else DEFAULT_DIGEST["daily_hour"],
        "weekly_day": weekday if weekday in VALID_WEEKDAYS else DEFAULT_DIGEST["weekly_day"],
    }

    # types
    sanitized_types: dict[str, dict[str, str]] = {}
    types_in = raw.get("types") or {}
    if isinstance(types_in, dict):
        for key, channels in types_in.items():
            t = get_type(key)
            if not t or t.get("transactional"):
                continue
            if not isinstance(channels, dict):
                continue
            allowed = t.get("allowed_channels", set())
            cleaned: dict[str, str] = {}
            for ch, freq in channels.items():
                if ch not in VALID_CHANNELS or ch not in allowed:
                    continue
                if freq not in VALID_FREQUENCIES:
                    continue
                # in_app only honours instant/off; coerce digest → instant
                if ch == "in_app" and freq in ("daily", "weekly"):
                    freq = "instant"
                cleaned[ch] = freq
            if cleaned:
                sanitized_types[key] = cleaned
    out["types"] = sanitized_types
    return out


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
