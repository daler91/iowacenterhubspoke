"""Microsoft OAuth 2.0 user consent flow for connecting employee Outlook Calendars."""

import secrets
import urllib.parse
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from database import db
from core.auth import SchedulerRequired
from core.logger import get_logger
from core.outlook_config import (
    OUTLOOK_OAUTH_ENABLED,
    OUTLOOK_OAUTH_CLIENT_ID,
    OUTLOOK_OAUTH_CLIENT_SECRET,
    OUTLOOK_OAUTH_REDIRECT_URI,
    OUTLOOK_OAUTH_AUTH_URL,
    OUTLOOK_OAUTH_TOKEN_URL,
    OUTLOOK_OAUTH_SCOPES,
    GRAPH_BASE_URL,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/outlook", tags=["outlook-oauth"])


@router.get(
    "/authorize/{employee_id}",
    summary="Start Microsoft OAuth flow for an employee",
    responses={
        400: {"description": "Outlook OAuth is not configured"},
        404: {"description": "Employee not found"},
    },
)
async def outlook_authorize(employee_id: str, user: SchedulerRequired):
    """Generate Microsoft OAuth consent URL and redirect the admin to it."""
    if not OUTLOOK_OAUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Outlook OAuth is not configured")

    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    state = secrets.token_urlsafe(32)
    await db.outlook_oauth_states.insert_one({
        "state": state,
        "employee_id": employee_id,
        "created_at": datetime.now(timezone.utc),
    })

    params = {
        "client_id": OUTLOOK_OAUTH_CLIENT_ID,
        "redirect_uri": OUTLOOK_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(OUTLOOK_OAUTH_SCOPES),
        "response_mode": "query",
        "prompt": "consent",
        "state": state,
        "login_hint": employee.get("email", ""),
    }
    auth_url = f"{OUTLOOK_OAUTH_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/callback", summary="Microsoft OAuth callback")
async def outlook_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle Microsoft OAuth callback, exchange code for tokens, store on employee."""
    if error:
        logger.warning("Microsoft OAuth error callback received")
        return _redirect_with_status("error", "error_auth")

    if not code or not state:
        return _redirect_with_status("error", "error_missing")

    state_doc = await db.outlook_oauth_states.find_one_and_delete({"state": state})
    employee_id = state_doc.get("employee_id") if state_doc else None
    if not employee_id:
        return _redirect_with_status("error", "error_state")

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(OUTLOOK_OAUTH_TOKEN_URL, data={
                "client_id": OUTLOOK_OAUTH_CLIENT_ID,
                "client_secret": OUTLOOK_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": OUTLOOK_OAUTH_REDIRECT_URI,
                "scope": " ".join(OUTLOOK_OAUTH_SCOPES),
            }, timeout=10)
            resp.raise_for_status()
            tokens = resp.json()
    except Exception:
        logger.exception("Failed to exchange Microsoft OAuth code for tokens")
        return _redirect_with_status("error", "error_exchange")

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    if not refresh_token:
        from core.logger import mask_id as _mask
        logger.error(
            "No refresh_token in Microsoft OAuth response",
            extra={"entity": {"employee_id_masked": _mask(employee_id)}},
        )
        return _redirect_with_status("error", "error_token")

    # Fetch the Microsoft account email to verify identity
    outlook_email = None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{GRAPH_BASE_URL}/me", headers={
                "Authorization": f"Bearer {access_token}",
            }, timeout=10)
            if resp.status_code == 200:
                user_info = resp.json()
                outlook_email = user_info.get("mail") or user_info.get("userPrincipalName")
    except Exception:
        from core.logger import mask_id as _mask
        logger.warning(
            "Failed to fetch Microsoft user info",
            extra={"entity": {"employee_id_masked": _mask(employee_id)}},
        )

    # Store tokens on employee document (encrypted at rest)
    from core.token_vault import encrypt_token
    from core.logger import mask_id
    update = {
        "outlook_refresh_token": encrypt_token(refresh_token),
        "outlook_calendar_connected": True,
    }
    if outlook_email:
        update["outlook_calendar_email"] = outlook_email

    await db.employees.update_one({"id": employee_id}, {"$set": update})
    logger.info(
        "Outlook Calendar connected",
        extra={"entity": {"employee_id_masked": mask_id(employee_id)}},
    )

    return _redirect_with_status("success", "success")


@router.delete(
    "/{employee_id}/disconnect",
    summary="Disconnect Outlook Calendar for an employee",
    responses={
        400: {"description": "Outlook OAuth is not configured"},
        404: {"description": "Employee not found"},
    },
)
async def outlook_disconnect(employee_id: str, user: SchedulerRequired):
    """Remove stored Microsoft OAuth tokens for an employee."""
    if not OUTLOOK_OAUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Outlook OAuth is not configured")

    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    await db.employees.update_one(
        {"id": employee_id},
        {
            "$set": {"outlook_calendar_connected": False},
            "$unset": {
                "outlook_refresh_token": "",
                "outlook_calendar_email": "",
            },
        },
    )
    from core.logger import mask_id
    logger.info(
        "Outlook Calendar disconnected",
        extra={"entity": {"employee_id_masked": mask_id(employee_id)}},
    )
    return {"message": "Outlook Calendar disconnected"}


_OAUTH_MESSAGES = {
    "success": "Outlook Calendar connected successfully",
    "error_auth": "Microsoft authorization failed",
    "error_missing": "Missing authorization code or state",
    "error_state": "Invalid or expired OAuth state",
    "error_exchange": "Failed to exchange authorization code",
    "error_token": "No refresh token received. Please try again.",
}


def _redirect_with_status(status: str, message_key: str) -> RedirectResponse:
    """Redirect back to the frontend with status in query params."""
    message = _OAUTH_MESSAGES.get(message_key, "Unknown error")
    params = urllib.parse.urlencode({"outlook_oauth": status, "message": message})
    return RedirectResponse(url=f"/settings?{params}")
