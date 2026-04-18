"""Town-to-town travel detection and synchronization.

Detects when an employee has schedules at multiple locations on the same day
and calculates inter-location drive times.
"""

from collections import defaultdict

from database import db
from services.drive_time import get_drive_time_between_locations
from core.logger import get_logger

logger = get_logger(__name__)


async def check_town_to_town(employee_id, sched_date, location_id):
    """Check if employee has schedules at other locations on the same day."""
    same_day_schedules = await db.schedules.find(
        {
            "employee_ids": employee_id,
            "date": sched_date,
            "location_id": {"$ne": location_id},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(100)

    if not same_day_schedules:
        return False, None, None

    location_ids = list({s["location_id"] for s in same_day_schedules})
    other_locations = await db.locations.find(
        {"id": {"$in": location_ids}}, {"_id": 0}
    ).to_list(100)
    loc_map = {loc["id"]: loc for loc in other_locations}

    other_cities = []
    drive_minutes = None
    for s in same_day_schedules:
        if s["location_id"] in loc_map:
            other_cities.append(loc_map[s["location_id"]]["city_name"])

    for other_loc_id in location_ids:
        try:
            minutes = await get_drive_time_between_locations(location_id, other_loc_id)
            if minutes is not None:
                if drive_minutes is None or minutes < drive_minutes:
                    drive_minutes = minutes
        except Exception:
            logger.warning(
                "Failed to get drive time between %s and %s",
                location_id, other_loc_id, exc_info=True,
            )

    warning = _build_ttt_warning(drive_minutes, other_cities)
    return True, warning, drive_minutes


def _build_ttt_warning(drive_minutes, other_cities):
    city_list = ", ".join(other_cities)
    if drive_minutes is not None:
        return (
            f"Town-to-Town Travel: ~{drive_minutes} min drive between locations. "
            f"Other locations: {city_list}"
        )
    return (
        "Town-to-Town Travel Detected: Verify drive time manually. "
        f"Other locations: {city_list}"
    )


async def compute_min_drive_time(location_id, scheds, cache):
    drive_minutes = None
    for s in scheds:
        other_id = s["location_id"]
        pair_key = tuple(sorted([location_id, other_id]))
        if pair_key not in cache:
            try:
                cache[pair_key] = await get_drive_time_between_locations(location_id, other_id)
            except Exception:
                cache[pair_key] = None
        m = cache[pair_key]
        if m is not None and (drive_minutes is None or m < drive_minutes):
            drive_minutes = m
    return drive_minutes


async def check_town_to_town_bulk(
    employee_id: str, dates: list[str], location_id: str
):
    same_day_schedules = await db.schedules.find(
        {
            "employee_ids": employee_id,
            "date": {"$in": dates},
            "location_id": {"$ne": location_id},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(10000)

    schedules_by_date = defaultdict(list)
    for s in same_day_schedules:
        schedules_by_date[s["date"]].append(s)

    location_ids = list({s["location_id"] for s in same_day_schedules})
    if not location_ids:
        return {}

    other_locations = await db.locations.find(
        {"id": {"$in": location_ids}}, {"_id": 0}
    ).to_list(1000)
    loc_map = {loc["id"]: loc for loc in other_locations}

    results = {}
    drive_time_cache = {}
    for date, scheds in schedules_by_date.items():
        other_cities = list({
            loc_map[s["location_id"]]["city_name"]
            for s in scheds
            if s["location_id"] in loc_map
        })
        if not other_cities:
            continue
        drive_minutes = await compute_min_drive_time(location_id, scheds, drive_time_cache)
        warning = _build_ttt_warning(drive_minutes, other_cities)
        results[date] = (True, warning, drive_minutes)

    return results


async def sync_same_day_town_to_town(
    employee_id: str, date: str, exclude_id: str = None
):
    """Recalculate town-to-town for all sibling schedules on employee+date."""
    query = {"employee_ids": employee_id, "date": date, "deleted_at": None}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}
    siblings = await db.schedules.find(query, {"_id": 0}).to_list(100)

    # Batch-fetch all sibling locations up-front so the loop below does at
    # most one Mongo round-trip per sibling (the $set), not two.
    needed_loc_ids = {
        sib["location_id"] for sib in siblings
        if sib.get("location_id") and not sib.get("travel_override_minutes")
    }
    loc_by_id: dict[str, dict] = {}
    if needed_loc_ids:
        cursor = db.locations.find(
            {"id": {"$in": list(needed_loc_ids)}, "deleted_at": None}, {"_id": 0},
        )
        loc_by_id = {loc["id"]: loc async for loc in cursor}

    for sib in siblings:
        tt, tt_warning, tt_drive = await check_town_to_town(
            employee_id, date, sib["location_id"]
        )
        update = {
            "town_to_town": tt,
            "town_to_town_warning": tt_warning,
            "town_to_town_drive_minutes": tt_drive,
        }
        if not tt:
            update["town_to_town"] = False
            update["town_to_town_warning"] = None
            update["town_to_town_drive_minutes"] = None
        # ``travel_override_minutes`` was removed from the API surface but
        # legacy schedule docs may still carry it; respect the stored value
        # so we don't clobber a user's prior override on sibling resync.
        if not sib.get("travel_override_minutes"):
            loc = loc_by_id.get(sib.get("location_id"))
            if loc:
                update["drive_time_minutes"] = loc["drive_time_minutes"]
        await db.schedules.update_one({"id": sib["id"]}, {"$set": update})
