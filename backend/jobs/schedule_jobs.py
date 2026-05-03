from core.constants import MAX_QUERY_LIMIT


def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(":")
    return int(h) * 60 + int(m)


def _check_day_conflicts(day_schedules, new_start, new_end):
    conflicts = []
    for s in day_schedules:
        s_drive = s.get("drive_time_minutes", 0)
        s_start = time_to_minutes(s["start_time"]) - s_drive
        s_end = time_to_minutes(s["end_time"]) + s_drive
        if new_start < s_end and new_end > s_start:
            conflicts.append({"schedule_id": s["id"], "location": s.get("location_name", "?"), "time": f"{s['start_time']}-{s['end_time']}", "overlap": f"Blocks overlap (inc {s_drive}m drive)"})
    return conflicts


def _check_town_to_town(day_schedules, target_location_id, loc_map):
    other_day_locations = [s for s in day_schedules if s["location_id"] != target_location_id]
    if not other_day_locations:
        return False, None
    other_cities = [loc_map[s["location_id"]]["city_name"] for s in other_day_locations if s["location_id"] in loc_map]
    warning = "Town-to-Town Travel Detected: Verify drive time manually. Other locations: " + ", ".join(other_cities)
    return True, warning


async def _prefetch_schedule_data(db, data, dates_to_schedule):
    min_date = min(dates_to_schedule)
    max_date = max(dates_to_schedule)
    first_employee_id = data.employee_ids[0] if data.employee_ids else None
    if not first_employee_id:
        return {}, {}
    existing_schedules = await db.schedules.find({"employee_ids": first_employee_id, "date": {"$gte": min_date, "$lte": max_date}, "deleted_at": None}, {"_id": 0}).to_list(MAX_QUERY_LIMIT)
    schedules_by_date = {}
    for s in existing_schedules:
        schedules_by_date.setdefault(s["date"], []).append(s)
    location_ids = {s["location_id"] for s in existing_schedules if s["location_id"] != data.location_id}
    other_locations = []
    if location_ids:
        other_locations = await db.locations.find({"id": {"$in": list(location_ids)}}, {"_id": 0}).to_list(MAX_QUERY_LIMIT)
    return schedules_by_date, {loc["id"]: loc for loc in other_locations}


async def generate_bulk_schedules(*args, **kwargs):
    from worker import generate_bulk_schedules as _impl
    return await _impl(*args, **kwargs)


async def sync_schedules_denormalized(*args, **kwargs):
    from worker import sync_schedules_denormalized as _impl
    return await _impl(*args, **kwargs)
