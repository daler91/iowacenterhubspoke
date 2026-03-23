import asyncio
import time
import logging
import httpx
from core.outlook_config import (
    OUTLOOK_ENABLED, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
    GRAPH_BASE_URL, TOKEN_URL, OUTLOOK_TIMEZONE,
)

logger = logging.getLogger("outlook")

_token_cache = {"access_token": None, "expires_at": 0}
_token_lock = asyncio.Lock()


async def _get_access_token() -> str | None:
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
            async with httpx.AsyncClient() as client:
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
            logger.exception("Failed to acquire Microsoft Graph access token")
            return None


def _build_datetime(date: str, time_str: str) -> str:
    return f"{date}T{time_str}:00"


async def check_outlook_availability(
    email: str, date: str, start_time: str, end_time: str
) -> list[dict]:
    token = await _get_access_token()
    if not token:
        return []

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
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        logger.exception("Outlook getSchedule failed for user")
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
) -> str | None:
    token = await _get_access_token()
    if not token:
        return None

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
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }, timeout=10)
            resp.raise_for_status()
            return resp.json().get("id")
    except Exception:
        logger.exception("Failed to create Outlook event for user")
        return None


async def delete_outlook_event(email: str, event_id: str) -> bool:
    token = await _get_access_token()
    if not token:
        return False

    url = f"{GRAPH_BASE_URL}/users/{email}/events/{event_id}"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.delete(url, headers={
                "Authorization": f"Bearer {token}",
            }, timeout=10)
            resp.raise_for_status()
            return True
    except Exception:
        logger.exception("Failed to delete Outlook event %s for user", event_id)
        return False
