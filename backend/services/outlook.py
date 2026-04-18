import asyncio
import time
import logging
import httpx
from core.outlook_config import (
    OUTLOOK_ENABLED, OUTLOOK_OAUTH_ENABLED, OUTLOOK_CALENDAR_ENABLED,
    AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
    OUTLOOK_OAUTH_CLIENT_ID, OUTLOOK_OAUTH_CLIENT_SECRET, OUTLOOK_OAUTH_TOKEN_URL,
    GRAPH_BASE_URL, TOKEN_URL, OUTLOOK_TIMEZONE,
)

logger = logging.getLogger("outlook")

# Reusable async HTTP client (connection pooling)
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10)
    return _http_client


# Client credentials token cache (org-wide)
_token_cache = {"access_token": None, "expires_at": 0}
_token_lock = asyncio.Lock()

# OAuth per-employee token cache
_oauth_token_cache: dict[str, dict] = {}
_oauth_token_lock = asyncio.Lock()
# Per-email locks serialise refreshes for *one* user without blocking
# every other user on a slow token exchange. A module-wide lock was a
# head-of-line hazard: one stalled Microsoft response stalls every
# other employee's Graph call.
_oauth_token_locks: dict[str, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    lock = _oauth_token_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _oauth_token_locks[key] = lock
    return lock


async def _get_access_token_client_credentials() -> str | None:
    """Get access token via client credentials (org-wide application permissions)."""
    if not OUTLOOK_ENABLED:
        return None

    now = time.time()
    if _token_cache["access_token"] and _token_cache["expires_at"] > now + 300:
        return _token_cache["access_token"]

    async with _token_lock:
        # Double-check after acquiring lock
        if _token_cache["access_token"] and _token_cache["expires_at"] > now + 300:
            return _token_cache["access_token"]

        try:
            client = _get_http_client()
            resp = await client.post(TOKEN_URL, data={
                "client_id": AZURE_CLIENT_ID,
                "client_secret": AZURE_CLIENT_SECRET,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            _token_cache["access_token"] = data["access_token"]
            _token_cache["expires_at"] = now + data.get("expires_in", 3600)
            return _token_cache["access_token"]
        except Exception:
            logger.exception("Failed to acquire Microsoft Graph access token (client credentials)")
            return None


async def _refresh_outlook_oauth_token(refresh_token: str) -> dict | None:
    """Exchange a refresh token for a new access token via OAuth 2.0.

    Azure AD rotates refresh tokens by default — the response carries
    both a new ``access_token`` and a new ``refresh_token`` that
    supersedes the one we sent. Callers must persist the rotated
    refresh token back to the employee record or the next exchange
    will fail with an invalidated-grant error.
    """
    try:
        client = _get_http_client()
        resp = await client.post(OUTLOOK_OAUTH_TOKEN_URL, data={
            "client_id": OUTLOOK_OAUTH_CLIENT_ID,
            "client_secret": OUTLOOK_OAUTH_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
            "scope": "offline_access Calendars.ReadWrite User.Read",
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return {
            "access_token": data["access_token"],
            "expires_in": data.get("expires_in", 3600),
            # May be absent in rare configurations; passthrough None in
            # that case so the caller skips the DB write.
            "refresh_token": data.get("refresh_token"),
        }
    except Exception:
        logger.exception("Failed to refresh Outlook OAuth token")
        return None


async def _persist_rotated_refresh_token(email: str, new_refresh_token: str) -> None:
    """Encrypt the rotated refresh token and write it back to the
    employee record so the next exchange uses the current grant."""
    try:
        from database import db
        from core.token_vault import encrypt_token
        await db.employees.update_one(
            {"email": email, "deleted_at": None},
            {"$set": {"outlook_refresh_token": encrypt_token(new_refresh_token)}},
        )
    except Exception:
        logger.exception("Failed to persist rotated Outlook refresh token")


async def _get_access_token_oauth(refresh_token: str, email: str) -> str | None:
    """Get access token via stored OAuth refresh token (for individual accounts)."""
    now = time.time()
    cache_key = f"outlook_oauth:{email}"
    cached = _oauth_token_cache.get(cache_key)
    if cached and cached["access_token"] and cached["expires_at"] > now + 300:
        return cached["access_token"]

    async with _lock_for(cache_key):
        # Double-check under the per-email lock so concurrent requests
        # for the same user coalesce onto one refresh.
        cached = _oauth_token_cache.get(cache_key)
        if cached and cached["access_token"] and cached["expires_at"] > now + 300:
            return cached["access_token"]

        result = await _refresh_outlook_oauth_token(refresh_token)
        if not result:
            return None
        _oauth_token_cache[cache_key] = {
            "access_token": result["access_token"],
            "expires_at": now + result["expires_in"] - 300,
        }
        # Persist the rotated refresh token before returning so a
        # process restart uses the currently-valid grant.
        if result.get("refresh_token") and result["refresh_token"] != refresh_token:
            await _persist_rotated_refresh_token(email, result["refresh_token"])
        return result["access_token"]


async def _get_access_token(email: str = "", employee: dict | None = None) -> tuple[str | None, bool]:
    """Get an access token for the given email.

    Returns (token, is_delegated) where is_delegated indicates the token
    uses delegated permissions (OAuth) vs application permissions (client credentials).
    Delegated tokens must use /me/ endpoints, application tokens use /users/{email}/.
    """
    if not OUTLOOK_CALENDAR_ENABLED:
        return None, False

    # 1. Try OAuth refresh token (works for individual Microsoft accounts)
    if employee and employee.get("outlook_refresh_token") and OUTLOOK_OAUTH_ENABLED:
        from core.token_vault import decrypt_token
        token = await _get_access_token_oauth(
            decrypt_token(employee["outlook_refresh_token"]), email
        )
        if token:
            return token, True
        logger.warning("Outlook OAuth token refresh failed, trying client credentials")

    # 2. Fall back to client credentials (works for org-managed accounts)
    if OUTLOOK_ENABLED:
        token = await _get_access_token_client_credentials()
        return token, False

    return None, False


def _build_datetime(date: str, time_str: str) -> str:
    return f"{date}T{time_str}:00"


async def check_outlook_availability(
    email: str, date: str, start_time: str, end_time: str,
    employee: dict | None = None,
) -> list[dict]:
    token, is_delegated = await _get_access_token(email, employee)
    if not token:
        return []

    if is_delegated:
        url = f"{GRAPH_BASE_URL}/me/calendar/getSchedule"
    else:
        url = f"{GRAPH_BASE_URL}/users/{email}/calendar/getSchedule"

    body = {
        "schedules": [email],
        "startTime": {
            "dateTime": _build_datetime(date, start_time),
            "timeZone": OUTLOOK_TIMEZONE,
        },
        "endTime": {
            "dateTime": _build_datetime(date, end_time),
            "timeZone": OUTLOOK_TIMEZONE,
        },
        "availabilityViewInterval": 15,
    }

    try:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        # Fail OPEN (return no conflicts) but surface a warning so ops
        # can spot Graph outages. Failing closed would block every
        # schedule create during a Microsoft blip — the trade-off
        # here is "rare double-book on outage" vs "total scheduling
        # outage when a third-party API hiccups." We pick the former.
        logger.warning(
            "Outlook getSchedule unreachable — availability treated as free",
        )
        return []

    conflicts = []
    for schedule_info in data.get("value", []):
        for item in schedule_info.get("scheduleItems", []):
            status = item.get("status", "").lower()
            if status in ("busy", "tentative", "oof"):
                conflicts.append({
                    "source": "outlook",
                    "status": status,
                    "start": item.get("start", {}).get("dateTime", ""),
                    "end": item.get("end", {}).get("dateTime", ""),
                })
    return conflicts


async def create_outlook_event(
    email: str,
    subject: str,
    location: str,
    date: str,
    start_time: str,
    end_time: str,
    notes: str | None = None,
    employee: dict | None = None,
) -> str | None:
    token, is_delegated = await _get_access_token(email, employee)
    if not token:
        return None

    if is_delegated:
        url = f"{GRAPH_BASE_URL}/me/events"
    else:
        url = f"{GRAPH_BASE_URL}/users/{email}/events"

    body = {
        "subject": subject,
        "start": {
            "dateTime": _build_datetime(date, start_time),
            "timeZone": OUTLOOK_TIMEZONE,
        },
        "end": {
            "dateTime": _build_datetime(date, end_time),
            "timeZone": OUTLOOK_TIMEZONE,
        },
        "location": {"displayName": location},
        "isReminderOn": True,
        "reminderMinutesBeforeStart": 30,
    }
    if notes:
        body["body"] = {"contentType": "text", "content": notes}

    try:
        client = _get_http_client()
        resp = await client.post(url, json=body, headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }, timeout=10)
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception:
        logger.exception("Failed to create Outlook event for user")
        return None


async def delete_outlook_event(
    email: str, event_id: str, employee: dict | None = None,
) -> bool:
    token, is_delegated = await _get_access_token(email, employee)
    if not token:
        return False

    if is_delegated:
        url = f"{GRAPH_BASE_URL}/me/events/{event_id}"
    else:
        url = f"{GRAPH_BASE_URL}/users/{email}/events/{event_id}"

    try:
        client = _get_http_client()
        resp = await client.delete(url, headers={
            "Authorization": f"Bearer {token}",
        }, timeout=10)
        if resp.status_code in (404, 410):
            # Already gone — idempotent delete success.
            logger.info("Outlook event %s already deleted", event_id)
            return True
        resp.raise_for_status()
        return True
    except Exception:
        logger.exception("Failed to delete Outlook event %s for user", event_id)
        return False
