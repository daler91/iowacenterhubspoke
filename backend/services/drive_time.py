import os
import math
from datetime import datetime, timezone
from collections import OrderedDict
import threading

import httpx

from core.logger import get_logger
from database import db

logger = get_logger(__name__)

# Reusable async HTTP client for Google API calls (connection pooling)
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=10)
    return _http_client


GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
HUB_LAT = 41.5868
HUB_LNG = -93.654
CACHE_TTL_DAYS = 30

# In-memory LRU cache for drive times (avoids repeated MongoDB lookups)
_MEM_CACHE_MAX = 500
_mem_cache: OrderedDict[str, tuple[int, float]] = OrderedDict()  # key -> (minutes, timestamp)
_mem_lock = threading.Lock()


def _mem_get(key: str) -> int | None:
    """Get drive time from in-memory cache if fresh."""
    with _mem_lock:
        entry = _mem_cache.get(key)
        if entry is None:
            return None
        minutes, ts = entry
        age_days = (datetime.now(timezone.utc).timestamp() - ts) / 86400
        if age_days >= CACHE_TTL_DAYS:
            _mem_cache.pop(key, None)
            return None
        _mem_cache.move_to_end(key)
        return minutes


def _mem_set(key: str, minutes: int):
    """Store drive time in in-memory cache, evicting oldest if full."""
    with _mem_lock:
        _mem_cache[key] = (minutes, datetime.now(timezone.utc).timestamp())
        _mem_cache.move_to_end(key)
        while len(_mem_cache) > _MEM_CACHE_MAX:
            _mem_cache.popitem(last=False)


def _haversine_miles(lat1, lng1, lat2, lng2):
    R = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _estimate_drive_minutes(lat1, lng1, lat2, lng2):
    """Estimate drive time using haversine distance with a 1.4x road factor at 55 mph avg."""
    miles = _haversine_miles(lat1, lng1, lat2, lng2)
    road_miles = miles * 1.4
    return max(1, round(road_miles / 55 * 60))


_MAX_API_RETRIES = 2


async def _fetch_distance_matrix(origin_lat, origin_lng, dest_lat, dest_lng):
    """Call Google Distance Matrix API and return duration in minutes.

    Retries transient failures up to _MAX_API_RETRIES times.
    """
    if not GOOGLE_MAPS_API_KEY:
        return None

    url = "https://maps.googleapis.com/maps/api/distancematrix/json"
    params = {
        "origins": f"{origin_lat},{origin_lng}",
        "destinations": f"{dest_lat},{dest_lng}",
        "mode": "driving",
        "units": "imperial",
        "key": GOOGLE_MAPS_API_KEY,
    }

    client = _get_http_client()
    last_error = None
    for attempt in range(_MAX_API_RETRIES + 1):
        try:
            resp = await client.get(url, params=params)
            data = resp.json()

            if data.get("status") != "OK":
                logger.warning("Distance Matrix API error: %s", data.get("status"))
                return None

            element = data["rows"][0]["elements"][0]
            if element.get("status") != "OK":
                logger.warning("Distance Matrix element error: %s", element.get("status"))
                return None

            duration_seconds = element["duration"]["value"]
            return max(1, round(duration_seconds / 60))
        except (httpx.TransportError, httpx.TimeoutException) as e:
            last_error = e
            if attempt < _MAX_API_RETRIES:
                import asyncio
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
        except Exception as e:
            logger.error("Distance Matrix API call failed: %s", e)
            return None

    logger.error("Distance Matrix API failed after %d retries: %s", _MAX_API_RETRIES + 1, last_error)
    return None


def _cache_key(id_a, id_b):
    """Create a deterministic cache key from two location IDs (sorted)."""
    return "|".join(sorted([id_a, id_b]))


def _hub_cache_key(lat, lng):
    """Cache key for hub-to-coordinate lookups (rounded to 4 decimals)."""
    return f"hub|{round(lat, 4)}|{round(lng, 4)}"


async def _check_mongo_cache(cache_key):
    """Check MongoDB cache for a valid drive time entry. Returns minutes or None."""
    cached = await db.drive_time_cache.find_one({"key": cache_key}, {"_id": 0})
    if not cached:
        return None
    created = cached.get("created_at", "")
    if not created:
        return None
    try:
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(created)).days
        if age < CACHE_TTL_DAYS:
            _mem_set(cache_key, cached["drive_time_minutes"])
            return cached["drive_time_minutes"]
    except (ValueError, TypeError):
        logger.warning("Invalid cached drive time entry for key %s", cache_key)
    return None


async def get_drive_time_between(from_lat, from_lng, to_lat, to_lng, cache_key=None):
    """Get drive time between two coordinates. Checks in-memory cache, then MongoDB, then API, then estimates."""
    # 1. In-memory LRU cache (instant, no I/O)
    if cache_key:
        mem_hit = _mem_get(cache_key)
        if mem_hit is not None:
            return mem_hit, True

    # 2. MongoDB cache
    if cache_key:
        mongo_hit = await _check_mongo_cache(cache_key)
        if mongo_hit is not None:
            return mongo_hit, True

    # 3. Google Distance Matrix API
    minutes = await _fetch_distance_matrix(from_lat, from_lng, to_lat, to_lng)
    source = "api"
    if minutes is None:
        minutes = _estimate_drive_minutes(from_lat, from_lng, to_lat, to_lng)
        source = "estimate"

    # 4. Store in both caches
    if cache_key:
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        _mem_set(cache_key, minutes)
        await db.drive_time_cache.update_one(
            {"key": cache_key},
            {"$set": {
                "key": cache_key,
                "drive_time_minutes": minutes,
                "source": source,
                "created_at": now.isoformat(),
                "expires_at": now + timedelta(days=CACHE_TTL_DAYS),
            }},
            upsert=True,
        )

    return minutes, False


async def get_drive_time_between_locations(from_id, to_id):
    """Get drive time between two location IDs."""
    locations = await db.locations.find(
        {"id": {"$in": [from_id, to_id]}, "deleted_at": None}, {"_id": 0}
    ).to_list(2)

    loc_map = {loc["id"]: loc for loc in locations}
    from_loc = loc_map.get(from_id)
    to_loc = loc_map.get(to_id)

    if not from_loc or not to_loc:
        return None
    if not (from_loc.get("latitude") and from_loc.get("longitude")
            and to_loc.get("latitude") and to_loc.get("longitude")):
        return None

    key = _cache_key(from_id, to_id)
    minutes, _ = await get_drive_time_between(
        from_loc["latitude"], from_loc["longitude"],
        to_loc["latitude"], to_loc["longitude"],
        cache_key=key,
    )
    return minutes


async def get_drive_time_from_hub(lat, lng):
    """Get drive time from Hub (Des Moines) to given coordinates."""
    key = _hub_cache_key(lat, lng)
    minutes, _ = await get_drive_time_between(
        HUB_LAT, HUB_LNG, lat, lng, cache_key=key,
    )
    return minutes
