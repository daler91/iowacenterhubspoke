"""Partner portal auth endpoints — magic link request and token verify."""

from fastapi import APIRouter, Request

from core.logger import get_logger
from core.portal_auth import validate_portal_token
from core.queue import safe_enqueue_job
from core.rate_limit import limiter
from models.coordination_schemas import PortalAuthRequest

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
async def verify_token(token: str):
    ctx = await validate_portal_token(token)
    return {
        "valid": True,
        "contact": ctx["contact"],
        "org": ctx["org"],
    }
