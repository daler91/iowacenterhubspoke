import asyncio
import time
import logging
import httpx
from google.oauth2 import service_account

from core.google_config import (
    GOOGLE_CALENDAR_ENABLED,
    GOOGLE_SERVICE_ACCOUNT_FILE,
    GOOGLE_SA_CLIENT_EMAIL,
    GOOGLE_SA_PRIVATE_KEY,
    GOOGLE_SA_PROJECT_ID,
    GOOGLE_CALENDAR_API_BASE,
    GOOGLE_CALENDAR_TIMEZONE,
    GOOGLE_CALENDAR_SCOPES,
)

logger = logging.getLogger("google_calendar")

# Token cache keyed by email (Google requires per-user impersonation)
_token_cache: dict[str, dict] = {}
_token_lock = asyncio.Lock()


def _build_credentials() -> service_account.Credentials | None:
    """Build base service account credentials (without subject)."""
    try:
        if GOOGLE_SERVICE_ACCOUNT_FILE:
            return service_account.Credentials.from_service_account_file(
                GOOGLE_SERVICE_ACCOUNT_FILE,
                scopes=GOOGLE_CALENDAR_SCOPES,
            )
        else:
            info = {
                "type": "service_account",
                "client_email": GOOGLE_SA_CLIENT_EMAIL,
                "private_key": GOOGLE_SA_PRIVATE_KEY,
                "project_id": GOOGLE_SA_PROJECT_ID,
                "token_uri": "https://oauth2.googleapis.com/token",
            }
            return service_account.Credentials.from_service_account_info(
                info, scopes=GOOGLE_CALENDAR_SCOPES
            )
    except Exception:
        logger.exception("Failed to build Google service account credentials")
        return None


async def _get_access_token(email: str) -> str | None:
    if not GOOGLE_CALENDAR_ENABLED:
        return None

    now = time.time()
    cached = _token_cache.get(email)
    if cached and cached["access_token"] and cached["expires_at"] > now + 300:
        return cached["access_token"]

    async with _token_lock:
        # Double-check after acquiring lock
        cached = _token_cache.get(email)
        if cached and cached["access_token"] and cached["expires_at"] > now + 300:
            return cached["access_token"]

        try:
            base_creds = _build_credentials()
            if not base_creds:
                return None
            creds = base_creds.with_subject(email)
            # Refresh is a blocking I/O call; run in thread
            import google.auth.transport.requests
            await asyncio.to_thread(
                creds.refresh, google.auth.transport.requests.Request()
            )
            _token_cache[email] = {
                "access_token": creds.token,
                "expires_at": now + 3300,  # ~55 min (Google tokens last 1h)
            }
            return creds.token
        except Exception:
            logger.exception("Failed to acquire Google access token for %s", email)
            return None


def _build_datetime(date: str, time_str: str) -> str:
    return f"{date}T{time_str}:00"


async def check_google_availability(
    email: str, date: str, start_time: str, end_time: str
) -> list[dict]:
    token = await _get_access_token(email)
    if not token:
        return []

    url = f"{GOOGLE_CALENDAR_API_BASE}/freeBusy"
    body = {
        "timeMin": _build_datetime(date, start_time) + f"-06:00",
        "timeMax": _build_datetime(date, end_time) + f"-06:00",
        "timeZone": GOOGLE_CALENDAR_TIMEZONE,
        "items": [{"id": email}],
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.exception("Google freeBusy failed for %s", email)
        return []

    conflicts = []
    calendar_data = data.get("calendars", {}).get(email, {})
    for busy_block in calendar_data.get("busy", []):
        conflicts.append({
            "source": "google",
            "status": "busy",
            "start": busy_block.get("start", ""),
            "end": busy_block.get("end", ""),
        })
    return conflicts


async def create_google_event(
    email: str,
    subject: str,
    location: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str | None = None,
) -> str | None:
    token = await _get_access_token(email)
    if not token:
        return None

    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{email}/events"
    body = {
        "summary": subject,
        "location": location,
        "start": {
            "dateTime": _build_datetime(date, start_time),
            "timeZone": GOOGLE_CALENDAR_TIMEZONE,
        },
        "end": {
            "dateTime": _build_datetime(date, end_time),
            "timeZone": GOOGLE_CALENDAR_TIMEZONE,
        },
        "reminders": {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": 30}],
        },
    }
    if notes:
        body["description"] = notes

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }, timeout=10)
            resp.raise_for_status()
            return resp.json().get("id")
    except Exception:
        logger.exception("Failed to create Google Calendar event for %s", email)
        return None


async def delete_google_event(email: str, event_id: str) -> bool:
    token = await _get_access_token(email)
    if not token:
        return False

    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{email}/events/{event_id}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(url, headers={
                "Authorization": f"Bearer {token}",
            }, timeout=10)
            resp.raise_for_status()
            return True
    except Exception:
        logger.exception("Failed to delete Google Calendar event %s for %s", event_id, email)
        return False
