import os
import math
from datetime import datetime, timezone

import httpx

from core.logger import get_logger
from database import db

logger = get_logger(__name__)

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
HUB_LAT = 41.5868
HUB_LNG = -93.654
CACHE_TTL_DAYS = 30


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


async def _fetch_distance_matrix(origin_lat, origin_lng, dest_lat, dest_lng):
    """Call Google Distance Matrix API and return duration in minutes."""
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

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            data = resp.json()

        if data.get("status") != "OK":
            logger.warning(f"Distance Matrix API error: {data.get('status')}")
            return None

        element = data["rows"][0]["elements"][0]
        if element.get("status") != "OK":
            logger.warning(f"Distance Matrix element error: {element.get('status')}")
            return None

        duration_seconds = element["duration"]["value"]
        return max(1, round(duration_seconds / 60))
    except Exception as e:
        logger.error(f"Distance Matrix API call failed: {e}")
        return None


def _cache_key(id_a, id_b):
    """Create a deterministic cache key from two location IDs (sorted)."""
    return "|".join(sorted([id_a, id_b]))


def _hub_cache_key(lat, lng):
    """Cache key for hub-to-coordinate lookups (rounded to 4 decimals)."""
    return f"hub|{round(lat, 4)}|{round(lng, 4)}"


async def get_drive_time_between(from_lat, from_lng, to_lat, to_lng, cache_key=None):
    """Get drive time between two coordinates. Checks cache, then API, then estimates."""
    if cache_key:
        cached = await db.drive_time_cache.find_one({"key": cache_key}, {"_id": 0})
        if cached:
            created = cached.get("created_at", "")
            if created:
                try:
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(created)).days
                    if age < CACHE_TTL_DAYS:
                        return cached["drive_time_minutes"], True
                except (ValueError, TypeError):
                    pass

    minutes = await _fetch_distance_matrix(from_lat, from_lng, to_lat, to_lng)
    source = "api"
    if minutes is None:
        minutes = _estimate_drive_minutes(from_lat, from_lng, to_lat, to_lng)
        source = "estimate"

    if cache_key:
        await db.drive_time_cache.update_one(
            {"key": cache_key},
            {"$set": {
                "key": cache_key,
                "drive_time_minutes": minutes,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
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
    if not (from_loc.get("latitude") and from_loc.get("longitude") and to_loc.get("latitude") and to_loc.get("longitude")):
        return None

    key = _cache_key(from_id, to_id)
    minutes, cached = await get_drive_time_between(
        from_loc["latitude"], from_loc["longitude"],
        to_loc["latitude"], to_loc["longitude"],
        cache_key=key,
    )
    return minutes


async def get_drive_time_from_hub(lat, lng):
    """Get drive time from Hub (Des Moines) to given coordinates."""
    key = _hub_cache_key(lat, lng)
    minutes, cached = await get_drive_time_between(
        HUB_LAT, HUB_LNG, lat, lng, cache_key=key,
    )
    return minutes
