"""Background arq jobs for outbound email.

These handlers are invoked by the arq worker, never directly from a
request handler. Request-handler timing must not depend on whether an
email exists in the database — that's an enumeration side channel. All
of the DB lookups, token creation, and SMTP work for anti-enumeration
endpoints (password reset, partner portal magic link) lives here so the
handler can return its generic response in constant time.
"""
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from database import db
from services.email import (
    send_password_reset,
    send_portal_invite,
    resolve_app_url,
)
from core.logger import get_logger

logger = get_logger(__name__)

import os as _os  # noqa: E402

# Password reset links default to 24 hours so a delayed email arrival
# (mailbox filtering, offline device) doesn't force the user to restart
# the flow. Override via PASSWORD_RESET_EXPIRY_HOURS.
PASSWORD_RESET_EXPIRY_HOURS = int(_os.environ.get("PASSWORD_RESET_EXPIRY_HOURS", "24"))
# Portal magic links default to 3 days. One-time-use behaviour is enforced
# separately when the portal records last_used_at.
PORTAL_TOKEN_EXPIRY_DAYS = int(_os.environ.get("PORTAL_TOKEN_EXPIRY_DAYS", "3"))


async def send_password_reset_email(email: str) -> None:
    """Look up a user by email, create a reset token, and send the email.

    Silently no-ops if the email doesn't correspond to any user — this
    mirrors the handler's generic response. Intended to run inside an
    arq worker, off the request path.
    """
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        logger.info(
            "Password reset requested for unknown email (silent no-op)",
        )
        return

    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
    # expires_at stored as native datetime so the MongoDB TTL index prunes rows automatically.
    await db.password_resets.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "token": token,
        "expires_at": expires,
        "created_at": now.isoformat(),
        "used_at": None,
    })
    logger.info(
        "Password reset token created",
        extra={"entity": {"user_id": user["id"]}},
    )

    try:
        reset_url = f"{resolve_app_url()}/reset-password/{token}"
        await send_password_reset(
            to=user["email"],
            name=user.get("name", ""),
            reset_url=reset_url,
        )
    except Exception as e:
        logger.warning(
            "Failed to send password reset email to %s: %s",
            user["email"], e,
        )


async def send_partner_magic_link_email(email: str) -> None:
    """Look up a partner contact by email and send the portal magic link.

    Silently no-ops if the email doesn't correspond to any active
    contact. Intended to run inside an arq worker, off the request path.
    """
    contact = await db.partner_contacts.find_one(
        {"email": email, "deleted_at": None}, {"_id": 0},
    )
    if not contact:
        logger.info(
            "Portal magic link requested for unknown email (silent no-op)",
        )
        return

    token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=PORTAL_TOKEN_EXPIRY_DAYS)
    await db.portal_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "contact_id": contact["id"],
        "token": token,
        "expires_at": expires,
        "created_at": now.isoformat(),
        "last_used_at": None,
    })
    logger.info("Portal token created for contact %s", contact["id"])

    try:
        org = await db.partner_orgs.find_one(
            {"id": contact["partner_org_id"], "deleted_at": None},
            {"_id": 0, "name": 1},
        )
        portal_url = f"{resolve_app_url()}/portal/{token}"
        await send_portal_invite(
            to=contact["email"],
            contact_name=contact.get("name", "there"),
            org_name=(org or {}).get("name", "Partner"),
            portal_url=portal_url,
        )
    except Exception as e:
        logger.warning(
            "Failed to send portal magic-link email to %s: %s",
            contact["email"], e,
        )
