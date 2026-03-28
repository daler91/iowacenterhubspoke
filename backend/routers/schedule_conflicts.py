"""Schedule conflict checking and travel chain building."""

from typing import Optional

from fastapi import APIRouter, HTTPException

from database import db
from models.schemas import ScheduleCreate, ErrorResponse
from core.auth import CurrentUser
from services.schedule_utils import check_conflicts, check_outlook_conflicts
from services.drive_time import get_drive_time_between_locations
from routers.schedule_helpers import (
    logger,
    LOCATION_NOT_FOUND,
    HUB_LABEL,
    _add_minutes_to_time,
    _subtract_minutes_from_time,
    _check_town_to_town,
)

router = APIRouter(tags=["schedules"])


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
    first_entry = entries[0]
    first_loc = loc_map.get(first_entry["location_id"])
    default_first_drive = first_loc["drive_time_minutes"] if first_loc else 0
    first_override = first_entry.get("drive_to_override_minutes")
    first_hub_drive = first_override if first_override else default_first_drive
    is_first_overridden = first_override is not None and first_override > 0
    first_drive_end = first_entry["start_time"]
    first_drive_start = _subtract_minutes_from_time(first_drive_end, first_hub_drive)
    legs.append(
        {
            "type": "drive",
            "from_label": HUB_LABEL,
            "to_label": first_entry["location_name"],
            "minutes": first_hub_drive,
            "start_time": first_drive_start,
            "end_time": first_drive_end,
            "is_overridden": is_first_overridden,
            "override_field": "drive_to",
            "owner_is_current": first_entry["is_current"],
            "owner_schedule_id": first_entry.get("schedule_id"),
        }
    )
    total_drive += first_hub_drive

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
            if entry["location_id"] == next_entry["location_id"]:
                drive_min = 0
                is_overridden = False
            else:
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
                    drive_min = from_override
                    is_overridden = True
                elif to_override:
                    drive_min = to_override
                    is_overridden = True
                else:
                    drive_min = calculated
                    is_overridden = False
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
            # Last leg: last location -> Hub
            last_loc = loc_map.get(entry["location_id"])
            default_last_drive = last_loc["drive_time_minutes"] if last_loc else 0
            from_override = entry.get("drive_from_override_minutes")
            last_hub_drive = from_override if from_override else default_last_drive
            is_last_overridden = from_override is not None and from_override > 0
            last_drive_start = entry["end_time"]
            last_drive_end = _add_minutes_to_time(last_drive_start, last_hub_drive)
            legs.append(
                {
                    "type": "drive",
                    "from_label": entry["location_name"],
                    "to_label": HUB_LABEL,
                    "minutes": last_hub_drive,
                    "start_time": last_drive_start,
                    "end_time": last_drive_end,
                    "is_overridden": is_last_overridden,
                    "override_field": "drive_from",
                    "owner_is_current": entry["is_current"],
                    "owner_schedule_id": entry.get("schedule_id"),
                }
            )
            total_drive += last_hub_drive

    return {
        "legs": legs,
        "total_drive_minutes": total_drive,
        "class_count": len(entries),
    }


@router.post(
    "/check-conflicts",
    responses={
        404: {"model": ErrorResponse, "description": LOCATION_NOT_FOUND}
    },
)
async def check_schedule_conflicts(data: ScheduleCreate, user: CurrentUser):
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
    conflicts = await check_conflicts(
        data.employee_id, data.date, data.start_time, data.end_time, drive_time
    )
    outlook_conflicts = await check_outlook_conflicts(
        data.employee_id, data.date, data.start_time, data.end_time
    )

    travel_chain = None
    town_to_town_info = None
    if data.employee_id and data.date and data.location_id:
        travel_chain = await _build_travel_chain(
            data.employee_id,
            data.date,
            data.location_id,
            data.start_time,
            data.end_time,
            schedule_id=getattr(data, "schedule_id", None),
            drive_to_override=data.drive_to_override_minutes,
            drive_from_override=data.drive_from_override_minutes,
        )
        tt, tt_warning, tt_drive_min = await _check_town_to_town(
            data.employee_id, data.date, data.location_id
        )
        if tt:
            same_day = await db.schedules.find(
                {
                    "employee_id": data.employee_id,
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
        "has_conflicts": len(conflicts) > 0 or len(outlook_conflicts) > 0,
        "conflicts": conflicts,
        "outlook_conflicts": outlook_conflicts,
        "town_to_town": town_to_town_info,
        "travel_chain": travel_chain,
    }
