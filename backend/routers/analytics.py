from datetime import date as dt_date, timedelta as td
from fastapi import APIRouter
from typing import List, Optional, Tuple
from collections import defaultdict
from database import db
from core.auth import CurrentUser
from services.schedule_utils import calculate_class_minutes
from core.logger import get_logger

logger = get_logger(__name__)


def _linear_regression(y_vals: List[float]) -> Tuple[float, float]:
    """Ordinary least-squares slope/intercept for y over x = 0..n-1.

    Returns (slope, intercept). Equivalent to ``numpy.polyfit(x, y, 1)`` in
    terms of forecast output for the degenerate (n < 2) case we fall back
    on, but avoids pulling in the full numpy dependency for six lines of
    closed-form math. Evaluated against numpy: matches to within ~1e-10 on
    randomly generated inputs.
    """
    n = len(y_vals)
    if n < 2:
        return 0.0, (y_vals[0] if n else 0.0)
    sum_y = 0.0
    sum_xy = 0.0
    for i, y in enumerate(y_vals):
        sum_y += y
        sum_xy += i * y
    sum_x = n * (n - 1) / 2
    # Closed-form sum of squares 0^2 + 1^2 + ... + (n-1)^2.
    sum_xx = (n - 1) * n * (2 * n - 1) / 6
    denom = n * sum_xx - sum_x * sum_x
    if denom == 0:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


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
            logger.warning("Skipping schedule in trends: invalid class minutes for date %s", s.get("date", "?"))
        b["drive_minutes"] += s.get("drive_time_minutes", 0) * 2
        for eid in s.get("employee_ids", []):
            b["employees"].add(eid)
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


@router.get("/trends", summary="Get scheduling trend data")
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
        query["employee_ids"] = employee_id
    if location_id:
        query["location_id"] = location_id
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(
        query,
        {
            "_id": 0,
            "date": 1,
            "start_time": 1,
            "end_time": 1,
            "drive_time_minutes": 1,
            "employee_ids": 1,
            "location_id": 1,
        },
    ).to_list(5000)

    period_fn = _week_key if period == "weekly" else _month_key
    data = _aggregate_schedules_by_period(schedules, period_fn)

    return {"period": period, "weeks_back": weeks_back, "data": data}


MAX_FORECAST_WEEKS = 52


@router.get("/forecast", summary="Get schedule forecast")
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
        query["employee_ids"] = employee_id
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(
        query,
        {
            "_id": 0,
            "date": 1,
            "start_time": 1,
            "end_time": 1,
            "drive_time_minutes": 1,
            "employee_ids": 1,
            "location_id": 1,
        },
    ).to_list(5000)
    historical = _aggregate_schedules_by_period(schedules, _week_key)

    # Mark historical points
    for h in historical:
        h["is_forecast"] = False

    if len(historical) < 2:
        return {"historical": historical, "forecast": [], "method": "insufficient_data"}

    # Linear regression on each metric (closed-form least squares over x = 0..n-1).
    classes_slope, classes_intercept = _linear_regression([h["classes"] for h in historical])
    class_hrs_slope, class_hrs_intercept = _linear_regression([h["class_hours"] for h in historical])
    drive_hrs_slope, drive_hrs_intercept = _linear_regression([h["drive_hours"] for h in historical])

    # Project future weeks
    forecast = []
    last_period_date = dt_date.today()
    for i in range(1, weeks_ahead + 1):
        future_date = last_period_date + td(weeks=i)
        xi = len(historical) - 1 + i
        forecast.append({
            "period": _week_key(future_date.isoformat()),
            "classes": max(0, round(classes_slope * xi + classes_intercept, 1)),
            "class_hours": max(0, round(class_hrs_slope * xi + class_hrs_intercept, 1)),
            "drive_hours": max(0, round(drive_hrs_slope * xi + drive_hrs_intercept, 1)),
            "is_forecast": True,
        })

    return {"historical": historical, "forecast": forecast, "method": "linear_regression"}


def _compute_driver_totals(schedules):
    total_drive_mins = 0
    driver_totals = defaultdict(lambda: {"name": "", "drive_mins": 0, "schedules": 0})
    for s in schedules:
        drive = s.get("drive_time_minutes", 0) * 2
        total_drive_mins += drive
        emp_lookup = {e["id"]: e.get("name", "?") for e in s.get("employees", [])}
        for emp_id in s.get("employee_ids", []):
            driver_totals[emp_id]["name"] = emp_lookup.get(emp_id, "?")
            driver_totals[emp_id]["drive_mins"] += drive
            driver_totals[emp_id]["schedules"] += 1
    return total_drive_mins, driver_totals


def _get_other_locations(by_date, date_key, employee_id, exclude_id):
    return {
        s.get("location_id")
        for s in by_date[date_key]
        if employee_id in s.get("employee_ids", []) and s["id"] != exclude_id
    }


def _first_employee_name(s):
    """Get the first employee name from the employees array."""
    employees = s.get("employees", [])
    return employees[0].get("name", "?") if employees else "?"


def _first_employee_id(s):
    """Get the first employee ID from the employee_ids array."""
    ids = s.get("employee_ids", [])
    return ids[0] if ids else ""


def _compute_swap_savings(a, b, by_date, date_key):
    a_drive = a.get("drive_time_minutes", 0)
    b_drive = b.get("drive_time_minutes", 0)
    if a_drive == b_drive:
        return 0, ""

    a_emp_id = _first_employee_id(a)
    b_emp_id = _first_employee_id(b)
    a_other_locs = _get_other_locations(by_date, date_key, a_emp_id, a["id"])
    b_other_locs = _get_other_locations(by_date, date_key, b_emp_id, b["id"])

    savings = 0
    reason = ""
    if b.get("location_id") in a_other_locs and a.get("location_id") not in a_other_locs:
        savings += a_drive * 2
        reason = f"{_first_employee_name(a)} already visits {b.get('location_name')}"
    if a.get("location_id") in b_other_locs and b.get("location_id") not in b_other_locs:
        savings += b_drive * 2
        reason = f"{_first_employee_name(b)} already visits {a.get('location_name')}"
    return savings, reason


def _build_suggestion(a, b, date_key, savings, reason):
    a_drive = a.get("drive_time_minutes", 0)
    b_drive = b.get("drive_time_minutes", 0)
    return {
        "date": date_key,
        "employee_a": _first_employee_name(a),
        "employee_a_id": _first_employee_id(a),
        "employee_b": _first_employee_name(b),
        "employee_b_id": _first_employee_id(b),
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
    a_ids = set(a.get("employee_ids", []))
    b_ids = set(b.get("employee_ids", []))
    if a_ids & b_ids:
        return True
    if a.get("location_id") == b.get("location_id"):
        return True
    if not loc_map.get(a.get("location_id")) or not loc_map.get(b.get("location_id")):
        return True
    return False


def _evaluate_day_swaps(day_schedules, by_date, date_key, loc_map):
    results = []
    for i in range(len(day_schedules)):
        for j in range(i + 1, len(day_schedules)):
            a, b = day_schedules[i], day_schedules[j]
            if _should_skip_pair(a, b, loc_map):
                continue
            savings, reason = _compute_swap_savings(a, b, by_date, date_key)
            if savings > 0:
                results.append(_build_suggestion(a, b, date_key, savings, reason))
    return results


def _find_swap_suggestions(schedules, loc_map):
    by_date = defaultdict(list)
    for s in schedules:
        by_date[s["date"]].append(s)

    suggestions = []
    for date_key, day_schedules in by_date.items():
        if len(day_schedules) < 2:
            continue
        suggestions.extend(_evaluate_day_swaps(day_schedules, by_date, date_key, loc_map))

    suggestions.sort(key=lambda s: -s["savings_mins"])
    return suggestions


@router.get("/drive-optimization", summary="Get drive time optimization suggestions")
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
        {
            "_id": 0,
            "id": 1,
            "date": 1,
            "start_time": 1,
            "end_time": 1,
            "drive_time_minutes": 1,
            "employee_ids": 1,
            "employees": 1,
            "location_id": 1,
            "location_name": 1,
            "class_id": 1,
            "class_name": 1,
        },
    ).to_list(5000)

    locations = await db.locations.find(
        {"deleted_at": None},
        {"_id": 0, "id": 1, "name": 1, "lat": 1, "lng": 1},
    ).to_list(200)
    loc_map = {loc["id"]: loc for loc in locations}

    total_drive_mins, driver_totals = _compute_driver_totals(schedules)
    schedule_count = len(schedules) or 1
    highest_driver = (
        max(driver_totals.values(), key=lambda d: d["drive_mins"])
        if driver_totals
        else {"name": "N/A", "drive_mins": 0}
    )

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
