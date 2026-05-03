from core.constants import MAX_QUERY_LIMIT


def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(":")
    return int(h) * 60 + int(m)


def _check_day_conflicts(day_schedules, new_start, new_end):
    conflicts = []
    for schedule in day_schedules:
        drive = schedule.get("drive_time_minutes", 0)
        existing_start = time_to_minutes(schedule["start_time"]) - drive
        existing_end = time_to_minutes(schedule["end_time"]) + drive
        if new_start < existing_end and new_end > existing_start:
            conflicts.append(
                {
                    "schedule_id": schedule["id"],
                    "location": schedule.get("location_name", "?"),
                    "time": f"{schedule['start_time']}-{schedule['end_time']}",
                    "overlap": f"Blocks overlap (inc {drive}m drive)",
                }
            )
    return conflicts


def _check_town_to_town(day_schedules, target_location_id, loc_map):
    other_day_locations = [
        schedule
        for schedule in day_schedules
        if schedule["location_id"] != target_location_id
    ]
    if not other_day_locations:
        return False, None
    other_cities = [
        loc_map[schedule["location_id"]]["city_name"]
        for schedule in other_day_locations
        if schedule["location_id"] in loc_map
    ]
    warning = (
        "Town-to-Town Travel Detected: Verify drive time manually. "
        f"Other locations: {', '.join(other_cities)}"
    )
    return True, warning


async def _prefetch_schedule_data(db, data, dates_to_schedule):
    min_date = min(dates_to_schedule)
    max_date = max(dates_to_schedule)
    first_employee_id = data.employee_ids[0] if data.employee_ids else None
    if not first_employee_id:
        return {}, {}
    existing_schedules = await db.schedules.find(
        {
            "employee_ids": first_employee_id,
            "date": {"$gte": min_date, "$lte": max_date},
            "deleted_at": None,
        },
        {"_id": 0},
    ).to_list(MAX_QUERY_LIMIT)
    schedules_by_date = {}
    for schedule in existing_schedules:
        schedules_by_date.setdefault(schedule["date"], []).append(schedule)
    location_ids = {
        schedule["location_id"]
        for schedule in existing_schedules
        if schedule["location_id"] != data.location_id
    }
    other_locations = []
    if location_ids:
        other_locations = await db.locations.find(
            {"id": {"$in": list(location_ids)}},
            {"_id": 0},
        ).to_list(MAX_QUERY_LIMIT)
    return schedules_by_date, {loc["id"]: loc for loc in other_locations}

