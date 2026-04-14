"""Notification preferences + inbox endpoints.

Two audiences are served here:

- **Internal users** (``/me/notification-preferences``, ``/notifications/inbox``)
  authenticated via the standard JWT cookie/bearer (``CurrentUser``).
- **Partner contacts** (``/portal/me/notification-preferences``,
  ``/portal/notifications/inbox``) authenticated via the magic-link
  bearer token (``PortalContext``).

Both paths share the same underlying services — only the principal
resolution differs.
"""

from fastapi import APIRouter, HTTPException

from core.auth import CurrentUser
from core.logger import get_logger
from core.notification_types import (
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    serialize_type_for_api,
    visible_types_for,
)
from core.portal_auth import PortalContext
from models.schemas import NotificationPreferencesUpdate
from services.notification_prefs import (
    Principal,
    get_effective_prefs,
    load_principal,
    sanitize_update,
    save_prefs,
)
from services.notifications import (
    count_unread,
    dismiss as dismiss_notification,
    list_inbox,
    mark_all_read,
    mark_read,
)


logger = get_logger(__name__)

router = APIRouter(tags=["notifications"])


# ── Helpers ────────────────────────────────────────────────────────────

async def _load_internal(user: dict) -> Principal:
    principal = await load_principal("internal", user["user_id"])
    if principal is None:
        raise HTTPException(status_code=404, detail="User not found")
    return principal


def _portal_principal(ctx: dict) -> Principal:
    """Build a Principal from the portal auth context (no DB round-trip)."""
    contact = ctx["contact"]
    return Principal(
        kind="partner",
        id=contact["id"],
        email=contact.get("email"),
        name=contact.get("name"),
        role=None,
        prefs=contact.get("notification_preferences") or {},
    )


def _registry_payload(audience: str, role: str | None) -> dict:
    types = visible_types_for(audience, role)  # type: ignore[arg-type]
    # Group by category for UI convenience.
    by_category: dict[str, list[dict]] = {cat: [] for cat in CATEGORY_ORDER}
    for t in types:
        by_category[t["category"]].append(serialize_type_for_api(t))
    return {
        "categories": [
            {
                "key": cat,
                "label": CATEGORY_LABELS.get(cat, cat.title()),
                "types": by_category[cat],
            }
            for cat in CATEGORY_ORDER
            if by_category[cat]
        ],
    }


# ── Internal user endpoints ────────────────────────────────────────────

@router.get(
    "/me/notification-preferences",
    summary="Get my notification preferences + registry",
)
async def get_my_prefs(user: CurrentUser):
    principal = await _load_internal(user)
    return {
        "registry": _registry_payload("internal", principal.role),
        "preferences": get_effective_prefs(principal),
    }


@router.put(
    "/me/notification-preferences",
    summary="Update my notification preferences",
)
async def put_my_prefs(body: NotificationPreferencesUpdate, user: CurrentUser):
    principal = await _load_internal(user)
    sanitized = sanitize_update(body.model_dump(exclude_none=False))
    await save_prefs(principal, sanitized)
    return {
        "registry": _registry_payload("internal", principal.role),
        "preferences": get_effective_prefs(principal),
    }


@router.get(
    "/notifications/inbox",
    summary="List my persistent notifications",
)
async def get_inbox(user: CurrentUser, include_dismissed: bool = False, limit: int = 50):
    items = await list_inbox(
        "internal", user["user_id"],
        include_dismissed=include_dismissed, limit=limit,
    )
    unread = await count_unread("internal", user["user_id"])
    return {"items": items, "unread_count": unread}


@router.post("/notifications/inbox/{notification_id}/read", summary="Mark a notification read")
async def post_mark_read(notification_id: str, user: CurrentUser):
    ok = await mark_read("internal", user["user_id"], notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/notifications/inbox/{notification_id}/dismiss", summary="Dismiss a notification")
async def post_dismiss(notification_id: str, user: CurrentUser):
    ok = await dismiss_notification("internal", user["user_id"], notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post("/notifications/inbox/mark-all-read", summary="Mark every notification read")
async def post_mark_all_read(user: CurrentUser):
    modified = await mark_all_read("internal", user["user_id"])
    return {"modified": modified}


# ── Partner portal endpoints ───────────────────────────────────────────

@router.get(
    "/portal/me/notification-preferences",
    summary="Portal: get my notification preferences",
    tags=["portal"],
)
async def portal_get_prefs(ctx: PortalContext):
    # Re-read from DB so prefs updated in another tab are reflected
    principal = await load_principal("partner", ctx["contact"]["id"])
    if principal is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    return {
        "registry": _registry_payload("partner", None),
        "preferences": get_effective_prefs(principal),
    }


@router.put(
    "/portal/me/notification-preferences",
    summary="Portal: update my notification preferences",
    tags=["portal"],
)
async def portal_put_prefs(body: NotificationPreferencesUpdate, ctx: PortalContext):
    principal = await load_principal("partner", ctx["contact"]["id"])
    if principal is None:
        raise HTTPException(status_code=404, detail="Contact not found")
    sanitized = sanitize_update(body.model_dump(exclude_none=False))
    await save_prefs(principal, sanitized)
    return {
        "registry": _registry_payload("partner", None),
        "preferences": get_effective_prefs(principal),
    }


@router.get(
    "/portal/notifications/inbox",
    summary="Portal: list my persistent notifications",
    tags=["portal"],
)
async def portal_get_inbox(ctx: PortalContext, include_dismissed: bool = False, limit: int = 50):
    contact_id = ctx["contact"]["id"]
    items = await list_inbox(
        "partner", contact_id,
        include_dismissed=include_dismissed, limit=limit,
    )
    unread = await count_unread("partner", contact_id)
    return {"items": items, "unread_count": unread}


@router.post(
    "/portal/notifications/inbox/{notification_id}/read",
    summary="Portal: mark notification read",
    tags=["portal"],
)
async def portal_mark_read(notification_id: str, ctx: PortalContext):
    ok = await mark_read("partner", ctx["contact"]["id"], notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@router.post(
    "/portal/notifications/inbox/{notification_id}/dismiss",
    summary="Portal: dismiss notification",
    tags=["portal"],
)
async def portal_dismiss(notification_id: str, ctx: PortalContext):
    ok = await dismiss_notification("partner", ctx["contact"]["id"], notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
