"""Schedule conflict checking and travel chain building."""

from fastapi import APIRouter, HTTPException

from database import db
from models.schemas import ScheduleCreate, ErrorResponse
from core.auth import CurrentUser
from services.schedule_utils import check_conflicts, check_outlook_conflicts, check_google_conflicts
from services.drive_time import get_drive_time_between_locations
from routers.schedule_helpers import (
    LOCATION_NOT_FOUND,
    HUB_LABEL,
    _add_minutes_to_time,
    _subtract_minutes_from_time,
    _check_town_to_town,
)

router = APIRouter(tags=["schedules"])


def _build_hub_leg(entry, loc_map, direction):
    """Build a Hub↔location drive leg. direction is 'to' (Hub→loc) or 'from' (loc→Hub)."""
    loc = loc_map.get(entry["location_id"])
    default_drive = loc["drive_time_minutes"] if loc else 0
    override_field = "drive_to_override_minutes" if direction == "to" else "drive_from_override_minutes"
    override = entry.get(override_field)
    drive_min = override if override else default_drive
    is_overridden = override is not None and override > 0

    if direction == "to":
        drive_end = entry["start_time"]
        drive_start = _subtract_minutes_from_time(drive_end, drive_min)
        from_label, to_label = HUB_LABEL, entry["location_name"]
    else:
        drive_start = entry["end_time"]
        drive_end = _add_minutes_to_time(drive_start, drive_min)
        from_label, to_label = entry["location_name"], HUB_LABEL

    leg = {
        "type": "drive",
        "from_label": from_label,
        "to_label": to_label,
        "minutes": drive_min,
        "start_time": drive_start,
        "end_time": drive_end,
        "is_overridden": is_overridden,
        "override_field": "drive_to" if direction == "to" else "drive_from",
        "owner_is_current": entry["is_current"],
        "owner_schedule_id": entry.get("schedule_id"),
    }
    return leg, drive_min


async def _resolve_between_drive(entry, next_entry):
    """Resolve drive time and override status between two consecutive entries."""
    if entry["location_id"] == next_entry["location_id"]:
        return 0, False

    try:
        calculated = (
            await get_drive_time_between_locations(
                entry["location_id"], next_entry["location_id"]
            )
        ) or 0
    except Exception:
        calculated = 0

    from_override = entry.get("drive_from_override_minutes")
    to_override = next_entry.get("drive_to_override_minutes")
    if from_override:
        return from_override, True
    if to_override:
        return to_override, True
    return calculated, False


async def _build_travel_chain(
    employee_id: str,
    date: str,
    current_location_id: str,
    current_start: str,
    current_end: str,
    schedule_id: str = None,
    drive_to_override: int = None,
    drive_from_override: int = None,
):
    """Build the full day travel chain for an employee including the current form entry."""
    query = {"employee_id": employee_id, "date": date, "deleted_at": None}
    if schedule_id:
        query["id"] = {"$ne": schedule_id}
    db_schedules = await db.schedules.find(query, {"_id": 0}).to_list(100)

    entries = []
    for s in db_schedules:
        entries.append(
            {
                "schedule_id": s["id"],
                "location_id": s["location_id"],
                "location_name": s.get("location_name", "Unknown"),
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "is_current": False,
                "drive_to_override_minutes": s.get("drive_to_override_minutes"),
                "drive_from_override_minutes": s.get("drive_from_override_minutes"),
            }
        )

    current_loc = await db.locations.find_one(
        {"id": current_location_id}, {"_id": 0}
    )
    current_loc_name = current_loc["city_name"] if current_loc else "Unknown"
    entries.append(
        {
            "schedule_id": schedule_id,
            "location_id": current_location_id,
            "location_name": current_loc_name,
            "start_time": current_start,
            "end_time": current_end,
            "is_current": True,
            "drive_to_override_minutes": drive_to_override,
            "drive_from_override_minutes": drive_from_override,
        }
    )

    entries.sort(key=lambda e: e["start_time"])

    if not entries:
        return None

    loc_ids = list({e["location_id"] for e in entries})
    locations = await db.locations.find(
        {"id": {"$in": loc_ids}}, {"_id": 0}
    ).to_list(100)
    loc_map = {loc["id"]: loc for loc in locations}

    legs = []
    total_drive = 0

    # First leg: Hub -> first location
    first_leg, first_drive = _build_hub_leg(entries[0], loc_map, "to")
    legs.append(first_leg)
    total_drive += first_drive

    for i, entry in enumerate(entries):
        legs.append(
            {
                "type": "class",
                "location_name": entry["location_name"],
                "start_time": entry["start_time"],
                "end_time": entry["end_time"],
                "is_current": entry["is_current"],
            }
        )

        if i < len(entries) - 1:
            next_entry = entries[i + 1]
            drive_min, is_overridden = await _resolve_between_drive(entry, next_entry)
            between_start = entry["end_time"]
            between_end = _add_minutes_to_time(between_start, drive_min)
            legs.append(
                {
                    "type": "drive",
                    "from_label": entry["location_name"],
                    "to_label": next_entry["location_name"],
                    "minutes": drive_min,
                    "start_time": between_start,
                    "end_time": between_end,
                    "is_overridden": is_overridden,
                    "override_field": "drive_from",
                    "owner_is_current": entry["is_current"],
                    "owner_schedule_id": entry.get("schedule_id"),
                }
            )
            total_drive += drive_min
        else:
            last_leg, last_drive = _build_hub_leg(entry, loc_map, "from")
            legs.append(last_leg)
            total_drive += last_drive

    return {
        "legs": legs,
        "total_drive_minutes": total_drive,
        "class_count": len(entries),
    }


async def _check_conflicts_for_employee(
    employee_id: str, data: ScheduleCreate, location: dict, drive_time: int
):
    """Check all conflict types for a single employee."""
    conflicts = await check_conflicts(
        employee_id, data.date, data.start_time, data.end_time, drive_time
    )
    outlook_conflicts = await check_outlook_conflicts(
        employee_id, data.date, data.start_time, data.end_time
    )
    google_conflicts = await check_google_conflicts(
        employee_id, data.date, data.start_time, data.end_time
    )

    travel_chain = None
    town_to_town_info = None
    if employee_id and data.date and data.location_id:
        travel_chain = await _build_travel_chain(
            employee_id,
            data.date,
            data.location_id,
            data.start_time,
            data.end_time,
            schedule_id=getattr(data, "schedule_id", None),
            drive_to_override=data.drive_to_override_minutes,
            drive_from_override=data.drive_from_override_minutes,
        )
        tt, tt_warning, tt_drive_min = await _check_town_to_town(
            employee_id, data.date, data.location_id
        )
        if tt:
            same_day = await db.schedules.find(
                {
                    "employee_id": employee_id,
                    "date": data.date,
                    "location_id": {"$ne": data.location_id},
                    "deleted_at": None,
                },
                {"_id": 0, "location_name": 1},
            ).to_list(100)
            other_locations = list({s["location_name"] for s in same_day})
            town_to_town_info = {
                "detected": True,
                "drive_minutes": tt_drive_min,
                "other_locations": other_locations,
                "warning": tt_warning,
            }

    return {
        "has_conflicts": len(conflicts) > 0 or len(outlook_conflicts) > 0 or len(google_conflicts) > 0,
        "conflicts": conflicts,
        "outlook_conflicts": outlook_conflicts,
        "google_conflicts": google_conflicts,
        "town_to_town": town_to_town_info,
        "travel_chain": travel_chain,
    }


@router.post(
    "/check-conflicts",
    summary="Check for scheduling conflicts",
    responses={
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}
    },
)
async def check_schedule_conflicts(data: ScheduleCreate, user: CurrentUser):
    """Check for time conflicts and Outlook conflicts before creating a schedule.
    Supports multiple employees via employee_ids — returns per_employee breakdown."""
    location = await db.locations.find_one(
        {"id": data.location_id}, {"_id": 0}
    )
    if not location:
        raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    drive_time = (
        data.drive_to_override_minutes
        if data.drive_to_override_minutes
        else location["drive_time_minutes"]
    )

    employee_ids = data.employee_ids or [data.employee_id]

    # Single employee — backward compatible response
    if len(employee_ids) == 1:
        return await _check_conflicts_for_employee(
            employee_ids[0], data, location, drive_time
        )

    # Multiple employees — per-employee breakdown
    per_employee = {}
    any_conflicts = False
    for emp_id in employee_ids:
        result = await _check_conflicts_for_employee(
            emp_id, data, location, drive_time
        )
        # Add employee name for frontend display
        emp = await db.employees.find_one({"id": emp_id}, {"_id": 0, "name": 1})
        result["employee_name"] = emp["name"] if emp else emp_id
        per_employee[emp_id] = result
        if result["has_conflicts"]:
            any_conflicts = True

    return {
        "has_conflicts": any_conflicts,
        "per_employee": per_employee,
        # Provide empty top-level arrays for backward compat
        "conflicts": [],
        "outlook_conflicts": [],
        "google_conflicts": [],
        "town_to_town": None,
        "travel_chain": None,
    }
