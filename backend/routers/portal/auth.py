"""Partner portal auth endpoints — magic link request, verify, revoke."""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from core.auth import AdminRequired
from core.logger import get_logger
from core.portal_auth import validate_portal_token
from core.queue import safe_enqueue_job
from core.rate_limit import limiter
from database import db
from models.coordination_schemas import PortalAuthRequest
from services.activity import log_activity

from ._shared import INVALID_TOKEN

logger = get_logger(__name__)

router = APIRouter(prefix="/portal", tags=["portal"])


# Rate-limited to curb email spam and enumeration-by-timing. The response is
# intentionally invariant whether or not the contact exists (anti-enumeration).
# The DB lookup, token creation, and SMTP send are all dispatched to a
# background worker so request timing is identical regardless of input.
# `safe_enqueue_job` never raises, so Redis hiccups still return the generic
# response instead of a 500.
@router.post(
    "/auth/request-link",
    summary="Request a magic link for partner access",
)
@limiter.limit("3/minute")
async def request_magic_link(request: Request, data: PortalAuthRequest):  # NOSONAR(S3516)
    generic_response = {
        "message": "If that email is registered, a link has been sent.",
    }
    await safe_enqueue_job("send_partner_magic_link_email_job", data.email)
    return generic_response


@router.get(
    "/auth/verify/{token}",
    summary="Verify a portal token",
    responses={401: {"description": INVALID_TOKEN}},
)
async def verify_token(token: str, request: Request):
    ctx = await validate_portal_token(token, request=request)
    return {
        "valid": True,
        "contact": ctx["contact"],
        "org": ctx["org"],
    }


@router.get(
    "/auth/tokens",
    summary="List active portal tokens (admin only)",
)
async def list_portal_tokens(user: AdminRequired):
    """Return the most recent 500 portal tokens with their revocation state."""
    cursor = db.portal_tokens.find(
        {},
        {
            "_id": 0,
            "token": 0,  # never return the raw secret
        },
    ).sort("created_at", -1)
    tokens = await cursor.to_list(length=500)
    return {"tokens": tokens}


@router.delete(
    "/auth/tokens/{token_id}",
    summary="Revoke a portal token (admin only)",
    responses={404: {"description": "Token not found"}},
)
async def revoke_portal_token(token_id: str, user: AdminRequired):
    """Mark a portal token revoked. Subsequent validations return 401."""
    now = datetime.now(timezone.utc).isoformat()
    result = await db.portal_tokens.update_one(
        {"id": token_id, "revoked_at": None},
        {"$set": {"revoked_at": now, "revoked_by": user.get("email")}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Token not found or already revoked")
    await log_activity(
        action="portal.token.revoke",
        description=f"Portal token {token_id} revoked",
        entity_type="portal_token",
        entity_id=token_id,
        user_name=user.get("name", user.get("email", "admin")),
        user_id=user.get("user_id"),
    )
    logger.info(f"Portal token {token_id} revoked by {user.get('email')}")
    return {"message": "Token revoked"}
