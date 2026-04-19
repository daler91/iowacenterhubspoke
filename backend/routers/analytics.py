from datetime import date as dt_date, timedelta as td
from fastapi import APIRouter
from typing import List, Optional, Tuple
from collections import defaultdict
from itertools import combinations, product
from database import db
from core.auth import CurrentUser
from services.schedule_utils import calculate_class_minutes
from core.logger import get_logger

logger = get_logger(__name__)

_ANALYTICS_CAP = 5000
_SWAP_GUARDRAIL_DAY_SCHEDULE_THRESHOLD = 120
_SWAP_TOP_K_PER_EMPLOYEE_DAY = 6
_SWAP_TOP_K_PER_GROUP_APPROX = 2
_SWAP_MAX_APPROX_PAIRS_PER_DAY = 4000


def _warn_on_truncation(rows: list, query: dict, endpoint: str) -> None:
    """Log a warning when an analytics query hits the hard cap.

    Downstream math (trends, forecasts) silently produces misleading
    numbers if the underlying row set is truncated; surfacing a
    structured warning lets ops notice before stakeholders do.
    """
    if len(rows) >= _ANALYTICS_CAP:
        logger.warning(
            "Analytics query truncated at %d rows — results may be incomplete",
            _ANALYTICS_CAP,
            extra={"entity": {"endpoint": endpoint, "query": query}},
        )


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
    ).to_list(_ANALYTICS_CAP)
    _warn_on_truncation(schedules, query, "trends")

    period_fn = _week_key if period == "weekly" else _month_key
    data = _aggregate_schedules_by_period(schedules, period_fn)

    return {
        "period": period,
        "weeks_back": weeks_back,
        "data": data,
        "truncated": len(schedules) >= _ANALYTICS_CAP,
    }


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
    ).to_list(_ANALYTICS_CAP)
    _warn_on_truncation(schedules, query, "forecast")
    historical = _aggregate_schedules_by_period(schedules, _week_key)

    # Mark historical points
    for h in historical:
        h["is_forecast"] = False

    truncated = len(schedules) >= _ANALYTICS_CAP
    if len(historical) < 2:
        return {
            "historical": historical, "forecast": [],
            "method": "insufficient_data", "truncated": truncated,
        }

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

    return {
        "historical": historical, "forecast": forecast,
        "method": "linear_regression", "truncated": truncated,
    }


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


def _first_employee_name(s):
    """Get the first employee name from the employees array."""
    employees = s.get("employees", [])
    return employees[0].get("name", "?") if employees else "?"


def _first_employee_id(s):
    """Get the first employee ID from the employee_ids array."""
    ids = s.get("employee_ids", [])
    return ids[0] if ids else ""


def _derive_day_schedule_cache(day_schedules):
    by_primary_employee = defaultdict(list)
    by_location_and_primary_employee = defaultdict(list)
    employee_location_counts = defaultdict(lambda: defaultdict(int))
    cache = {}

    for s in day_schedules:
        first_emp_id = _first_employee_id(s)
        first_emp_name = _first_employee_name(s)
        location_id = s.get("location_id")
        schedule_id = s.get("id")
        drive_mins = s.get("drive_time_minutes", 0)
        employee_ids_set = set(s.get("employee_ids", []))

        by_primary_employee[first_emp_id].append(s)
        by_location_and_primary_employee[(location_id, first_emp_id)].append(s)
        for emp_id in employee_ids_set:
            employee_location_counts[emp_id][location_id] += 1
        cache[schedule_id] = {
            "first_employee_id": first_emp_id,
            "first_employee_name": first_emp_name,
            "employee_ids_set": employee_ids_set,
            "location_id": location_id,
            "drive_mins": drive_mins,
            "other_locations": set(),  # filled in after employee_locations built
        }

    for s in day_schedules:
        sid = s.get("id")
        cached = cache[sid]
        first_emp_id = cached["first_employee_id"]
        current_loc = cached["location_id"]
        visit_counts = employee_location_counts[first_emp_id]
        other_locations = set()
        for loc_id, visits in visit_counts.items():
            remaining_visits = visits
            if loc_id == current_loc and first_emp_id in cached["employee_ids_set"]:
                remaining_visits -= 1
            if remaining_visits > 0:
                other_locations.add(loc_id)
        cached["other_locations"] = other_locations

    return cache, by_primary_employee, by_location_and_primary_employee


def _prune_candidates(day_schedules, cache, top_k_per_employee):
    by_primary_employee = defaultdict(list)
    for s in day_schedules:
        sid = s.get("id")
        by_primary_employee[cache[sid]["first_employee_id"]].append(s)

    selected = []
    for schedules in by_primary_employee.values():
        ranked = sorted(schedules, key=lambda s: cache[s.get("id")]["drive_mins"], reverse=True)
        selected.extend(ranked[:top_k_per_employee])
    return selected


def _compute_swap_savings(a, b, cache):
    a_cache = cache[a.get("id")]
    b_cache = cache[b.get("id")]
    a_drive = a_cache["drive_mins"]
    b_drive = b_cache["drive_mins"]
    if a_drive == b_drive:
        return 0, ""

    a_other_locs = a_cache["other_locations"]
    b_other_locs = b_cache["other_locations"]

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


def _should_skip_pair(a, b, loc_map, cache):
    a_ids = cache[a.get("id")]["employee_ids_set"]
    b_ids = cache[b.get("id")]["employee_ids_set"]
    if a_ids & b_ids:
        return True
    if a.get("location_id") == b.get("location_id"):
        return True
    if not loc_map.get(a.get("location_id")) or not loc_map.get(b.get("location_id")):
        return True
    return False


def _group_pairs_for_evaluation(day_schedules, cache, approx_mode):
    groups = defaultdict(list)
    for s in day_schedules:
        sid = s.get("id")
        c = cache[sid]
        groups[(c["location_id"], c["first_employee_id"])].append(s)

    if approx_mode:
        for key in list(groups.keys()):
            groups[key] = sorted(
                groups[key], key=lambda s: cache[s.get("id")]["drive_mins"], reverse=True
            )[:_SWAP_TOP_K_PER_GROUP_APPROX]
    return list(groups.values())


def _can_day_produce_savings(day_schedules, cache):
    return any(cache[s.get("id")]["other_locations"] for s in day_schedules)


def _iter_group_pairs(grouped_schedules):
    for i, left_group in enumerate(grouped_schedules):
        for j in range(i, len(grouped_schedules)):
            right_group = grouped_schedules[j]
            pair_iter = (
                combinations(left_group, 2)
                if i == j
                else product(left_group, right_group)
            )
            yield from pair_iter


def _select_day_candidates(day_schedules, cache, approx_mode):
    if not approx_mode:
        return day_schedules
    return _prune_candidates(day_schedules, cache, _SWAP_TOP_K_PER_EMPLOYEE_DAY)


def _evaluate_day_swaps(day_schedules, date_key, loc_map, cache, approx_mode=False):
    if len(day_schedules) < 2:
        return []

    if not _can_day_produce_savings(day_schedules, cache):
        return []

    candidate_schedules = _select_day_candidates(day_schedules, cache, approx_mode)
    grouped_schedules = _group_pairs_for_evaluation(candidate_schedules, cache, approx_mode)

    results = []
    pair_count = 0
    for a, b in _iter_group_pairs(grouped_schedules):
        pair_count += 1
        if approx_mode and pair_count > _SWAP_MAX_APPROX_PAIRS_PER_DAY:
            return results
        if _should_skip_pair(a, b, loc_map, cache):
            continue
        savings, reason = _compute_swap_savings(a, b, cache)
        if savings > 0:
            results.append(_build_suggestion(a, b, date_key, savings, reason))
    return results


def _find_swap_suggestions(schedules, loc_map):
    by_date = defaultdict(list)
    for s in schedules:
        by_date[s["date"]].append(s)

    suggestions = []
    partial = False
    for date_key, day_schedules in by_date.items():
        cache, _by_emp, _by_loc_emp = _derive_day_schedule_cache(day_schedules)
        approx_mode = len(day_schedules) > _SWAP_GUARDRAIL_DAY_SCHEDULE_THRESHOLD
        if approx_mode:
            partial = True
        suggestions.extend(_evaluate_day_swaps(day_schedules, date_key, loc_map, cache, approx_mode=approx_mode))

    suggestions.sort(key=lambda s: -s["savings_mins"])
    return suggestions, partial


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
    ).to_list(_ANALYTICS_CAP)
    _warn_on_truncation(
        schedules,
        {"date_from": date_from, "date_to": date_to},
        "drive-optimization",
    )

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

    suggestions, partial = _find_swap_suggestions(schedules, loc_map)

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
        "partial": partial,
    }
