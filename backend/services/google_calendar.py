import asyncio
import time
import logging
import httpx
from google.oauth2 import service_account

from core.google_config import (
    GOOGLE_CALENDAR_ENABLED,
    GOOGLE_SERVICE_ACCOUNT_ENABLED,
    GOOGLE_OAUTH_ENABLED,
    GOOGLE_SERVICE_ACCOUNT_FILE,
    GOOGLE_SA_CLIENT_EMAIL,
    GOOGLE_SA_PRIVATE_KEY,
    GOOGLE_SA_PROJECT_ID,
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_TOKEN_URL,
    GOOGLE_CALENDAR_API_BASE,
    GOOGLE_CALENDAR_TIMEZONE,
    GOOGLE_CALENDAR_SCOPES,
)

logger = logging.getLogger("google_calendar")

# Token cache keyed by email
_token_cache: dict[str, dict] = {}
# Per-email locks so one user's slow refresh doesn't stall every
# other user on a module-wide mutex.
_token_locks: dict[str, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    lock = _token_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _token_locks[key] = lock
    return lock


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


async def _refresh_oauth_token(refresh_token: str) -> dict | None:
    """Exchange a refresh token for a new access token via OAuth 2.0."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(GOOGLE_OAUTH_TOKEN_URL, data={
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            return {
                "access_token": data["access_token"],
                "expires_in": data.get("expires_in", 3600),
            }
    except Exception:
        logger.exception("Failed to refresh Google OAuth token")
        return None


async def _get_access_token_service_account(email: str) -> str | None:
    """Get access token via service account impersonation (for Workspace accounts)."""
    now = time.time()
    cache_key = f"sa:{email}"
    cached = _token_cache.get(cache_key)
    if cached and cached["access_token"] and cached["expires_at"] > now + 300:
        return cached["access_token"]

    async with _lock_for(cache_key):
        cached = _token_cache.get(cache_key)
        if cached and cached["access_token"] and cached["expires_at"] > now + 300:
            return cached["access_token"]

        try:
            base_creds = _build_credentials()
            if not base_creds:
                return None
            creds = base_creds.with_subject(email)
            import google.auth.transport.requests
            await asyncio.to_thread(
                creds.refresh, google.auth.transport.requests.Request()
            )
            _token_cache[cache_key] = {
                "access_token": creds.token,
                "expires_at": now + 3300,
            }
            return creds.token
        except Exception:
            logger.exception("Failed to acquire Google service account token")
            return None


async def _get_access_token_oauth(refresh_token: str, email: str) -> str | None:
    """Get access token via stored OAuth refresh token (for Gmail accounts)."""
    now = time.time()
    cache_key = f"oauth:{email}"
    cached = _token_cache.get(cache_key)
    if cached and cached["access_token"] and cached["expires_at"] > now + 300:
        return cached["access_token"]

    async with _lock_for(cache_key):
        cached = _token_cache.get(cache_key)
        if cached and cached["access_token"] and cached["expires_at"] > now + 300:
            return cached["access_token"]

        result = await _refresh_oauth_token(refresh_token)
        if not result:
            return None
        _token_cache[cache_key] = {
            "access_token": result["access_token"],
            "expires_at": now + result["expires_in"] - 300,
        }
        return result["access_token"]


async def _get_access_token(email: str, employee: dict | None = None) -> str | None:
    """Get an access token for the given email.

    Tries OAuth refresh token first (if employee has one stored),
    then falls back to service account impersonation.
    """
    if not GOOGLE_CALENDAR_ENABLED:
        return None

    # 1. Try OAuth refresh token (works for regular Gmail)
    if employee and employee.get("google_refresh_token") and GOOGLE_OAUTH_ENABLED:
        from core.token_vault import decrypt_token
        token = await _get_access_token_oauth(
            decrypt_token(employee["google_refresh_token"]), email
        )
        if token:
            return token
        logger.warning("OAuth token refresh failed, trying service account")

    # 2. Fall back to service account (works for Workspace)
    if GOOGLE_SERVICE_ACCOUNT_ENABLED:
        return await _get_access_token_service_account(email)

    return None


def _build_datetime(date: str, time_str: str) -> str:
    return f"{date}T{time_str}:00"


def _tz_offset_for(date: str, time_str: str) -> str:
    """Return the correct UTC offset (e.g. ``-06:00`` or ``-05:00``) for a
    naive local wall-clock time on the given date in ``GOOGLE_CALENDAR_TIMEZONE``.

    America/Chicago is UTC-6 in winter and UTC-5 during daylight saving,
    so hard-coding an offset misreports freeBusy windows for half the year.
    """
    from datetime import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(GOOGLE_CALENDAR_TIMEZONE)
    except Exception:
        return "-06:00"
    try:
        naive = _dt.strptime(f"{date} {time_str}", "%Y-%m-%d %H:%M")
    except ValueError:
        return "-06:00"
    aware = naive.replace(tzinfo=tz)
    off = aware.utcoffset()
    if off is None:
        return "-06:00"
    total = int(off.total_seconds())
    sign = "+" if total >= 0 else "-"
    total = abs(total)
    return f"{sign}{total // 3600:02d}:{(total % 3600) // 60:02d}"


async def check_google_availability(
    email: str, date: str, start_time: str, end_time: str,
    employee: dict | None = None,
) -> list[dict]:
    token = await _get_access_token(email, employee)
    if not token:
        return []

    url = f"{GOOGLE_CALENDAR_API_BASE}/freeBusy"
    # RFC3339 requires an offset; ``_tz_offset_for`` computes it from the
    # configured timezone for the given date so DST transitions don't
    # silently shift the query window by an hour.
    start_offset = _tz_offset_for(date, start_time)
    end_offset = _tz_offset_for(date, end_time)
    body = {
        "timeMin": _build_datetime(date, start_time) + start_offset,
        "timeMax": _build_datetime(date, end_time) + end_offset,
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
        logger.exception("Google freeBusy check failed")
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
    employee: dict | None = None,
) -> str | None:
    token = await _get_access_token(email, employee)
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
        logger.exception("Failed to create Google Calendar event")
        return None


async def delete_google_event(
    email: str, event_id: str, employee: dict | None = None,
) -> bool:
    """Delete a Google Calendar event idempotently.

    A 404 means the event is already gone — that's a successful
    outcome for a delete, not a failure, so return True. Any other
    error surfaces as False and an exception log.
    """
    token = await _get_access_token(email, employee)
    if not token:
        return False

    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/{email}/events/{event_id}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(url, headers={
                "Authorization": f"Bearer {token}",
            }, timeout=10)
        if resp.status_code == 404 or resp.status_code == 410:
            # Already deleted — treat as success to match the caller's
            # "event has been removed from Google" expectation.
            logger.info("Google Calendar event %s already deleted", event_id)
            return True
        resp.raise_for_status()
        return True
    except Exception:
        logger.exception("Failed to delete Google Calendar event %s", event_id)
        return False
