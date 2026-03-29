"""Google OAuth 2.0 user consent flow for connecting employee Google Calendars."""

import secrets
import urllib.parse
import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from database import db
from core.auth import SchedulerRequired
from core.logger import get_logger
from core.google_config import (
    GOOGLE_OAUTH_ENABLED,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI,
    GOOGLE_OAUTH_AUTH_URL,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_CALENDAR_SCOPES,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/google", tags=["google-oauth"])

# In-memory state store (short-lived, maps state -> employee_id)
_oauth_states: dict[str, str] = {}


@router.get("/authorize/{employee_id}", summary="Start Google OAuth flow for an employee")
async def google_authorize(employee_id: str, user: SchedulerRequired):
    """Generate Google OAuth consent URL and redirect the admin to it."""
    if not GOOGLE_OAUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Google OAuth is not configured")

    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = employee_id

    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GOOGLE_CALENDAR_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "login_hint": employee.get("email", ""),
    }
    auth_url = f"{GOOGLE_OAUTH_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url}


@router.get("/callback", summary="Google OAuth callback")
async def google_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """Handle Google OAuth callback, exchange code for tokens, store on employee."""
    if error:
        logger.warning("Google OAuth error: %s", error)
        return _redirect_with_status("error", f"Google authorization failed: {error}")

    if not code or not state:
        return _redirect_with_status("error", "Missing authorization code or state")

    employee_id = _oauth_states.pop(state, None)
    if not employee_id:
        return _redirect_with_status("error", "Invalid or expired OAuth state")

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(GOOGLE_OAUTH_TOKEN_URL, data={
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": GOOGLE_OAUTH_REDIRECT_URI,
            }, timeout=10)
            resp.raise_for_status()
            tokens = resp.json()
    except Exception:
        logger.exception("Failed to exchange Google OAuth code for tokens")
        return _redirect_with_status("error", "Failed to exchange authorization code")

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    if not refresh_token:
        logger.error("No refresh_token in Google OAuth response for employee %s", employee_id)
        return _redirect_with_status("error", "No refresh token received. Please try again.")

    # Fetch the Google account email to verify identity
    google_email = None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={
                "Authorization": f"Bearer {access_token}",
            }, timeout=10)
            if resp.status_code == 200:
                google_email = resp.json().get("email")
    except Exception:
        logger.warning("Failed to fetch Google user info for employee %s", employee_id)

    # Store tokens on employee document
    update = {
        "google_refresh_token": refresh_token,
        "google_calendar_connected": True,
    }
    if google_email:
        update["google_calendar_email"] = google_email

    await db.employees.update_one({"id": employee_id}, {"$set": update})
    logger.info("Google Calendar connected for employee %s (email: %s)", employee_id, google_email or "unknown")

    return _redirect_with_status("success", "Google Calendar connected successfully")


@router.delete("/{employee_id}/disconnect", summary="Disconnect Google Calendar for an employee")
async def google_disconnect(employee_id: str, user: SchedulerRequired):
    """Remove stored Google OAuth tokens for an employee."""
    if not GOOGLE_OAUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Google OAuth is not configured")

    employee = await db.employees.find_one({"id": employee_id, "deleted_at": None}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Revoke the token with Google if possible
    refresh_token = employee.get("google_refresh_token")
    if refresh_token:
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://oauth2.googleapis.com/revoke",
                    params={"token": refresh_token},
                    timeout=5,
                )
        except Exception:
            logger.warning("Failed to revoke Google token for employee %s (non-critical)", employee_id)

    await db.employees.update_one(
        {"id": employee_id},
        {
            "$set": {"google_calendar_connected": False},
            "$unset": {
                "google_refresh_token": "",
                "google_calendar_email": "",
            },
        },
    )
    logger.info("Google Calendar disconnected for employee %s", employee_id)
    return {"message": "Google Calendar disconnected"}


def _redirect_with_status(status: str, message: str) -> RedirectResponse:
    """Redirect back to the frontend with status in query params."""
    params = urllib.parse.urlencode({"google_oauth": status, "message": message})
    return RedirectResponse(url=f"/?{params}")
