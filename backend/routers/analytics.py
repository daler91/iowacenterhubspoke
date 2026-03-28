from datetime import date as dt_date, timedelta as td, timezone, datetime
from fastapi import APIRouter
from typing import Optional
from collections import defaultdict
from database import db
from core.auth import CurrentUser
from services.schedule_utils import calculate_class_minutes
from core.logger import get_logger
import numpy as np

logger = get_logger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _week_key(date_str: str) -> str:
    d = dt_date.fromisoformat(date_str)
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _month_key(date_str: str) -> str:
    return date_str[:7]


def _aggregate_schedules_by_period(schedules, period_fn):
    buckets = defaultdict(lambda: {
        "classes": 0,
        "class_minutes": 0,
        "drive_minutes": 0,
        "employees": set(),
        "locations": set(),
    })
    for s in schedules:
        key = period_fn(s["date"])
        b = buckets[key]
        b["classes"] += 1
        try:
            b["class_minutes"] += calculate_class_minutes(s["start_time"], s["end_time"])
        except (ValueError, KeyError):
            pass
        b["drive_minutes"] += s.get("drive_time_minutes", 0) * 2
        b["employees"].add(s.get("employee_id", ""))
        b["locations"].add(s.get("location_id", ""))

    result = []
    for period in sorted(buckets.keys()):
        b = buckets[period]
        result.append({
            "period": period,
            "classes": b["classes"],
            "class_hours": round(b["class_minutes"] / 60, 1),
            "drive_hours": round(b["drive_minutes"] / 60, 1),
            "employees": len(b["employees"]),
            "locations": len(b["locations"]),
        })
    return result


@router.get("/trends")
async def get_trends(
    user: CurrentUser,
    period: str = "weekly",
    weeks_back: int = 12,
    employee_id: Optional[str] = None,
    location_id: Optional[str] = None,
    class_id: Optional[str] = None,
):
    cutoff = (dt_date.today() - td(weeks=weeks_back)).isoformat()
    query = {"date": {"$gte": cutoff}, "deleted_at": None}
    if employee_id:
        query["employee_id"] = employee_id
    if location_id:
        query["location_id"] = location_id
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(query, {"_id": 0}).to_list(5000)

    period_fn = _week_key if period == "weekly" else _month_key
    data = _aggregate_schedules_by_period(schedules, period_fn)

    return {"period": period, "weeks_back": weeks_back, "data": data}


MAX_FORECAST_WEEKS = 52


@router.get("/forecast")
async def get_forecast(
    user: CurrentUser,
    weeks_ahead: int = 8,
    employee_id: Optional[str] = None,
    class_id: Optional[str] = None,
):
    weeks_ahead = max(1, min(weeks_ahead, MAX_FORECAST_WEEKS))

    cutoff = (dt_date.today() - td(weeks=12)).isoformat()
    query = {"date": {"$gte": cutoff}, "deleted_at": None}
    if employee_id:
        query["employee_id"] = employee_id
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(query, {"_id": 0}).to_list(5000)
    historical = _aggregate_schedules_by_period(schedules, _week_key)

    # Mark historical points
    for h in historical:
        h["is_forecast"] = False

    if len(historical) < 2:
        return {"historical": historical, "forecast": [], "method": "insufficient_data"}

    # Linear regression on each metric
    x = np.arange(len(historical), dtype=float)
    classes_y = np.array([h["classes"] for h in historical], dtype=float)
    class_hrs_y = np.array([h["class_hours"] for h in historical], dtype=float)
    drive_hrs_y = np.array([h["drive_hours"] for h in historical], dtype=float)

    classes_fit = np.polyfit(x, classes_y, 1)
    class_hrs_fit = np.polyfit(x, class_hrs_y, 1)
    drive_hrs_fit = np.polyfit(x, drive_hrs_y, 1)

    # Project future weeks
    forecast = []
    last_period_date = dt_date.today()
    for i in range(1, weeks_ahead + 1):
        future_date = last_period_date + td(weeks=i)
        xi = len(historical) - 1 + i
        forecast.append({
            "period": _week_key(future_date.isoformat()),
            "classes": max(0, round(float(np.polyval(classes_fit, xi)), 1)),
            "class_hours": max(0, round(float(np.polyval(class_hrs_fit, xi)), 1)),
            "drive_hours": max(0, round(float(np.polyval(drive_hrs_fit, xi)), 1)),
            "is_forecast": True,
        })

    return {"historical": historical, "forecast": forecast, "method": "linear_regression"}


def _compute_driver_totals(schedules):
    total_drive_mins = 0
    driver_totals = defaultdict(lambda: {"name": "", "drive_mins": 0, "schedules": 0})
    for s in schedules:
        drive = s.get("drive_time_minutes", 0) * 2
        total_drive_mins += drive
        emp_id = s.get("employee_id", "")
        driver_totals[emp_id]["name"] = s.get("employee_name", "?")
        driver_totals[emp_id]["drive_mins"] += drive
        driver_totals[emp_id]["schedules"] += 1
    return total_drive_mins, driver_totals


def _get_other_locations(by_date, date_key, employee_id, exclude_id):
    return {
        s.get("location_id")
        for s in by_date[date_key]
        if s.get("employee_id") == employee_id and s["id"] != exclude_id
    }


def _compute_swap_savings(a, b, by_date, date_key):
    a_drive = a.get("drive_time_minutes", 0)
    b_drive = b.get("drive_time_minutes", 0)
    if a_drive == b_drive:
        return 0, ""

    a_other_locs = _get_other_locations(by_date, date_key, a.get("employee_id"), a["id"])
    b_other_locs = _get_other_locations(by_date, date_key, b.get("employee_id"), b["id"])

    savings = 0
    reason = ""
    if b.get("location_id") in a_other_locs and a.get("location_id") not in a_other_locs:
        savings += a_drive * 2
        reason = f"{a.get('employee_name')} already visits {b.get('location_name')}"
    if a.get("location_id") in b_other_locs and b.get("location_id") not in b_other_locs:
        savings += b_drive * 2
        reason = f"{b.get('employee_name')} already visits {a.get('location_name')}"
    return savings, reason


def _build_suggestion(a, b, date_key, savings, reason):
    a_drive = a.get("drive_time_minutes", 0)
    b_drive = b.get("drive_time_minutes", 0)
    return {
        "date": date_key,
        "employee_a": a.get("employee_name", "?"),
        "employee_a_id": a.get("employee_id"),
        "employee_b": b.get("employee_name", "?"),
        "employee_b_id": b.get("employee_id"),
        "location_a": a.get("location_name", "?"),
        "location_b": b.get("location_name", "?"),
        "schedule_a_id": a.get("id"),
        "schedule_b_id": b.get("id"),
        "current_drive_mins": (a_drive + b_drive) * 2,
        "optimized_drive_mins": (a_drive + b_drive) * 2 - savings,
        "savings_mins": savings,
        "reason": reason,
    }


def _should_skip_pair(a, b, loc_map):
    if a.get("employee_id") == b.get("employee_id"):
        return True
    if a.get("location_id") == b.get("location_id"):
        return True
    if not loc_map.get(a.get("location_id")) or not loc_map.get(b.get("location_id")):
        return True
    return False


def _find_swap_suggestions(schedules, loc_map):
    by_date = defaultdict(list)
    for s in schedules:
        by_date[s["date"]].append(s)

    suggestions = []
    for date_key, day_schedules in by_date.items():
        if len(day_schedules) < 2:
            continue
        for i in range(len(day_schedules)):
            for j in range(i + 1, len(day_schedules)):
                a, b = day_schedules[i], day_schedules[j]
                if _should_skip_pair(a, b, loc_map):
                    continue
                savings, reason = _compute_swap_savings(a, b, by_date, date_key)
                if savings > 0:
                    suggestions.append(_build_suggestion(a, b, date_key, savings, reason))

    suggestions.sort(key=lambda s: -s["savings_mins"])
    return suggestions


@router.get("/drive-optimization")
async def get_drive_optimization(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    if not date_from:
        date_from = dt_date.today().isoformat()
    if not date_to:
        date_to = (dt_date.fromisoformat(date_from) + td(weeks=4)).isoformat()

    schedules = await db.schedules.find(
        {"date": {"$gte": date_from, "$lte": date_to}, "deleted_at": None},
        {"_id": 0},
    ).to_list(5000)

    locations = await db.locations.find({"deleted_at": None}, {"_id": 0}).to_list(200)
    loc_map = {loc["id"]: loc for loc in locations}

    total_drive_mins, driver_totals = _compute_driver_totals(schedules)
    schedule_count = len(schedules) or 1
    highest_driver = max(driver_totals.values(), key=lambda d: d["drive_mins"]) if driver_totals else {"name": "N/A", "drive_mins": 0}

    suggestions = _find_swap_suggestions(schedules, loc_map)

    employee_drive = sorted(
        [{"name": v["name"], "drive_hours": round(v["drive_mins"] / 60, 1), "schedules": v["schedules"]}
         for v in driver_totals.values()],
        key=lambda d: -d["drive_hours"],
    )

    total_potential_savings = sum(s["savings_mins"] for s in suggestions)

    return {
        "summary": {
            "total_drive_hours": round(total_drive_mins / 60, 1),
            "avg_per_schedule": round(total_drive_mins / schedule_count / 60, 1),
            "highest_driver": highest_driver["name"],
            "highest_driver_hours": round(highest_driver["drive_mins"] / 60, 1),
            "potential_savings_hours": round(total_potential_savings / 60, 1),
        },
        "employee_drive": employee_drive,
        "suggestions": suggestions[:20],
    }
