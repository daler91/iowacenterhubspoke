from datetime import datetime, timezone
from typing import Annotated, Optional
from fastapi import Depends, Header, HTTPException, Request
from database import db

INVALID_TOKEN = "Invalid or expired portal link"
_LAST_USED_THROTTLE_SECONDS = 600  # 10 minutes


def _to_aware_datetime(value) -> datetime | None:
    """Accept native datetime or ISO string and return an aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.client
    return client.host if client else None


async def validate_portal_token(token: str, request: Optional[Request] = None) -> dict:
    """Validate a portal token string and return contact + org context."""
    token_doc = await db.portal_tokens.find_one({"token": token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=401, detail=INVALID_TOKEN)
    if token_doc.get("revoked_at"):
        raise HTTPException(status_code=401, detail="Portal link has been revoked")

    expires = _to_aware_datetime(token_doc.get("expires_at"))
    if not expires or expires < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=401,
            detail="Portal link has expired — please request a new one",
        )

    contact = await db.partner_contacts.find_one(
        {"id": token_doc["contact_id"], "deleted_at": None}, {"_id": 0}
    )
    if not contact:
        raise HTTPException(status_code=401, detail="Contact not found")

    org = await db.partner_orgs.find_one(
        {"id": contact["partner_org_id"], "deleted_at": None}, {"_id": 0}
    )
    if not org:
        raise HTTPException(status_code=401, detail="Partner organization not found")

    # Throttle last_used_at writes to once per 10 minutes
    now = datetime.now(timezone.utc)
    last_used = _to_aware_datetime(token_doc.get("last_used_at"))
    if not last_used or (now - last_used).total_seconds() > _LAST_USED_THROTTLE_SECONDS:
        update: dict = {"last_used_at": now.isoformat()}
        ip = _client_ip(request)
        if ip:
            update["last_used_ip"] = ip
        await db.portal_tokens.update_one(
            {"token": token},
            {"$set": update},
        )

    return {
        "contact": contact,
        "org": org,
        "partner_org_id": org["id"],
        "contact_id": contact["id"],
    }


async def get_portal_context_from_bearer(
    request: Request, authorization: str = Header(default="")
) -> dict:
    """FastAPI dependency that extracts a Bearer token and validates it."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    return await validate_portal_token(token, request=request)


PortalContext = Annotated[dict, Depends(get_portal_context_from_bearer)]
