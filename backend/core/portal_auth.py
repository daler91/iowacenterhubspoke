from datetime import datetime, timezone
from typing import Annotated
from fastapi import Depends, Header, HTTPException
from database import db

INVALID_TOKEN = "Invalid or expired portal link"
_LAST_USED_THROTTLE_SECONDS = 600  # 10 minutes


async def validate_portal_token(token: str) -> dict:
    """Validate a portal token string and return contact + org context."""
    token_doc = await db.portal_tokens.find_one({"token": token}, {"_id": 0})
    if not token_doc:
        raise HTTPException(status_code=401, detail=INVALID_TOKEN)
    if token_doc.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Portal link has expired")

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
    last_used = token_doc.get("last_used_at")
    if not last_used or (now - datetime.fromisoformat(last_used)).total_seconds() > _LAST_USED_THROTTLE_SECONDS:
        await db.portal_tokens.update_one(
            {"token": token},
            {"$set": {"last_used_at": now.isoformat()}},
        )

    return {"contact": contact, "org": org, "partner_org_id": org["id"]}


async def get_portal_context_from_bearer(authorization: str = Header(default="")) -> dict:
    """FastAPI dependency that extracts a Bearer token and validates it."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    return await validate_portal_token(token)


PortalContext = Annotated[dict, Depends(get_portal_context_from_bearer)]
