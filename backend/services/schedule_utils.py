import calendar
import os
from typing import Optional
from database import db
from models.schemas import RecurrenceRule, ScheduleCreate
from core.logger import get_logger

logger = get_logger(__name__)

SINGLE_CONFLICT_LOG_THRESHOLD = 100
BULK_CONFLICT_LOG_THRESHOLD = 10_000

SCHEDULE_CONFLICT_PROJECTION = {
    "id": 1,
    "start_time": 1,
    "end_time": 1,
    "drive_time_minutes": 1,
    "location_name": 1,
    "date": 1,
}

# Default to Central Time (Iowa) but leave overridable for tenants in
# other zones without forcing a config change in code.
SCHEDULE_TIMEZONE = os.environ.get("SCHEDULE_TIMEZONE", "America/Chicago")


def validate_local_time_exists(date_str: str, time_str: str, tz_name: str | None = None) -> None:
    """Reject times that don't exist in the local zone (DST spring-forward).

    On the spring-forward Sunday a single hour (typically 02:00–02:59 in
    Chicago) simply doesn't exist — the wall clock jumps from 01:59 to
    03:00. Storing a ``02:30`` schedule for that date would quietly
    de-reference an imaginary instant. Raises ``ValueError`` with a
    human-readable explanation on failure.

    Ambiguous fall-back times (1:30am occurring twice) are accepted —
    they map to *a* real instant, just not a uniquely defined one;
    fold=0 picks the earlier occurrence consistently.
    """
    # zoneinfo is stdlib on Python 3.9+ — the project pins 3.11.
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    try:
        tz = ZoneInfo(tz_name or SCHEDULE_TIMEZONE)
    except Exception:
        # Unknown zone — skip validation rather than break scheduling.
        return

    try:
        naive = _dt.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    except ValueError as exc:
        # Belt-and-suspenders: upstream schemas carry pattern validators
        # for HH:MM / YYYY-MM-DD, but if a caller ever reaches us with a
        # malformed value we raise instead of silently allowing the
        # garbage to persist. A ValueError message that reads like a
        # format issue is what the API handler expects to re-raise as
        # 400.
        raise ValueError(
            f"Invalid date/time format: {date_str!r} {time_str!r} "
            "(expected YYYY-MM-DD and HH:MM)"
        ) from exc

    # A "nonexistent" local time round-trips through UTC to a *different*
    # wall-clock reading — the local hour shifts forward into the gap. An
    # ambiguous fall-back time round-trips cleanly (fold=0 consistently
    # picks the first occurrence both ways). So round-trip divergence
    # uniquely identifies the spring-forward hole.
    aware = naive.replace(tzinfo=tz)
    round_tripped = aware.astimezone(ZoneInfo("UTC")).astimezone(tz)
    if round_tripped.replace(tzinfo=None) != naive:
        raise ValueError(
            f"{date_str} {time_str} is inside the daylight-saving "
            f"transition for {tz_name or SCHEDULE_TIMEZONE} and is not "
            "a valid wall-clock time. Please pick a different time."
        )


def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(':')
    return int(h) * 60 + int(m)


def calculate_class_minutes(start_time: str, end_time: str) -> int:
    return time_to_minutes(end_time) - time_to_minutes(start_time)


# Recurrence arithmetic uses ``datetime.date`` — not ``datetime`` — on
# purpose. Dates are calendar days with no time component and no
# timezone, so they are immune to DST transitions: adding 1 day across
# a spring-forward or fall-back boundary still yields the next
# wall-clock calendar date, which is exactly what "every Monday" or
# "the 15th of each month" means to end users. If you're tempted to
# switch this to ``datetime`` for a time-zone-aware recurrence, read
# AGENT_REVIEW_REPORT.md Suggestion 6 first and pair it with a test
# covering 2026-03-08 (US spring-forward) and 2026-11-01 (fall-back).
def add_months(source_date, months: int, *, anchor_day: Optional[int] = None):
    """Add months, preserving an optional anchor day-of-month.

    Without ``anchor_day`` (default) the function snaps to the last valid
    day when the target month is too short: Jan 31 + 1 month → Feb 28,
    Feb 28 + 1 month → Mar 28 (drift). Pass ``anchor_day`` to preserve
    the original intent: Jan 31 + 1 month (anchor_day=31) → Feb 28,
    Feb 28 + 1 month (anchor_day=31) → Mar 31.
    """
    month_index = source_date.month - 1 + months
    year = source_date.year + (month_index // 12)
    month = month_index % 12 + 1
    target_day = anchor_day if anchor_day is not None else source_date.day
    day = min(target_day, calendar.monthrange(year, month)[1])
    return source_date.replace(year=year, month=month, day=day)


def get_start_weekday_value(start_date):
    return (start_date.weekday() + 1) % 7


def build_recurrence_rule(data: ScheduleCreate):
    from datetime import date as dt_date

    start_date = dt_date.fromisoformat(data.date)
    if data.recurrence_end_date:
        default_end_mode = "on_date"
    elif data.recurrence_occurrences:
        default_end_mode = "after_occurrences"
    else:
        default_end_mode = "never"
    end_mode = data.recurrence_end_mode or default_end_mode

    if not data.recurrence or data.recurrence == "none":
        return None

    if data.recurrence == "custom":
        return data.custom_recurrence

    if data.recurrence == "weekly":
        return RecurrenceRule(
            interval=1,
            frequency="week",
            weekdays=[get_start_weekday_value(start_date)],
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    if data.recurrence == "biweekly":
        return RecurrenceRule(
            interval=2,
            frequency="week",
            weekdays=[get_start_weekday_value(start_date)],
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    if data.recurrence == "monthly":
        return RecurrenceRule(
            interval=1,
            frequency="month",
            end_mode=end_mode,
            end_date=data.recurrence_end_date,
            occurrences=data.recurrence_occurrences,
        )

    return None


def _build_monthly_dates(start_date, interval, occurrence_limit, end_date, *, preserve_day: bool = True):
    """Generate monthly recurrence dates.

    When ``preserve_day`` is True (the default) we anchor on the original
    day-of-month so a "monthly on the 31st" series hits Jan 31, Feb 28/29,
    Mar 31, Apr 30, May 31, ... rather than drifting to 28 after the
    first short month. Set ``preserve_day=False`` to use naive "day after
    last occurrence" behaviour.
    """
    dates = []
    current = start_date
    anchor_day = start_date.day if preserve_day else None
    step = 0
    while True:
        if end_date and current > end_date:
            break
        dates.append(current.isoformat())
        if occurrence_limit and len(dates) >= occurrence_limit:
            break
        step += interval
        if preserve_day:
            current = add_months(start_date, step, anchor_day=anchor_day)
        else:
            current = add_months(current, interval)
    return dates


def _build_weekly_dates(start_date, interval, weekdays, occurrence_limit, end_date):
    from datetime import timedelta as td
    dates = []
    hard_stop = end_date or (start_date + td(days=366 * 2))
    current = start_date
    while current <= hard_stop:
        weekday_value = (current.weekday() + 1) % 7
        weeks_since_start = (current - start_date).days // 7
        if weekday_value in weekdays and weeks_since_start % interval == 0:
            dates.append(current.isoformat())
            if occurrence_limit and len(dates) >= occurrence_limit:
                break
        current += td(days=1)
    return dates


def _parse_recurrence_limits(rule):
    from datetime import date as dt_date
    default_limit = 24 if rule.frequency == "month" else 52
    occurrence_limit = None
    if rule.end_mode == "after_occurrences":
        occurrence_limit = max(rule.occurrences or 1, 1)
    elif rule.end_mode == "never":
        occurrence_limit = default_limit
    end_date = None
    if rule.end_mode == "on_date" and rule.end_date:
        end_date = dt_date.fromisoformat(rule.end_date)
    return occurrence_limit, end_date


def build_recurrence_dates(start_date_str: str, rule: Optional[RecurrenceRule]):
    from datetime import date as dt_date

    if not rule:
        return [start_date_str]

    start_date = dt_date.fromisoformat(start_date_str)
    interval = max(rule.interval or 1, 1)
    occurrence_limit, end_date = _parse_recurrence_limits(rule)

    if rule.frequency == "month":
        dates = _build_monthly_dates(start_date, interval, occurrence_limit, end_date)
        return dates or [start_date_str]

    weekdays = sorted(set(rule.weekdays or [get_start_weekday_value(start_date)]))
    dates = _build_weekly_dates(start_date, interval, weekdays, occurrence_limit, end_date)
    return dates or [start_date_str]


async def check_conflicts(
    employee_id: str, date: str, start_time: str, end_time: str,
    drive_minutes: int, exclude_id: str = None
):
    new_start = time_to_minutes(start_time) - drive_minutes
    new_end = time_to_minutes(end_time) + drive_minutes

    query = {"employee_ids": employee_id, "date": date, "deleted_at": None}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}

    # Debug-level trace only — deliberately no request-derived fields in
    # the log record. Including ``employee_id`` / ``date`` from the call
    # site triggers CodeQL py/clear-text-logging-sensitive-data since
    # those values are tainted back to the HTTP request body via the
    # bulk-schedule routes.
    logger.debug("Checking conflicts")

    conflicts = []
    seen_count = 0
    async for s in db.schedules.find(query, SCHEDULE_CONFLICT_PROJECTION):
        seen_count += 1
        s_drive = s.get('drive_time_minutes', 0)
        s_start = time_to_minutes(s['start_time']) - s_drive
        s_end = time_to_minutes(s['end_time']) + s_drive
        if new_start < s_end and new_end > s_start:
            conflicts.append({
                "schedule_id": s['id'],
                "location": s.get('location_name', '?'),
                "time": f"{s['start_time']}-{s['end_time']}",
                "overlap": f"Blocks overlap (including {s_drive}m drive)"
            })

    if seen_count > SINGLE_CONFLICT_LOG_THRESHOLD:
        logger.warning(
            "Large conflict candidate result set",
            extra={"context": {"candidate_count": seen_count}}
        )

    return conflicts


async def check_outlook_conflicts(
    employee_id: str,
    date: str,
    start_time: str,
    end_time: str,
    employee: dict | None = None,
) -> list:
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    if not OUTLOOK_CALENDAR_ENABLED:
        return []

    if employee is None:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee or not employee.get("email"):
        return []

    from services.outlook import check_outlook_availability
    return await check_outlook_availability(employee["email"], date, start_time, end_time, employee=employee)


async def check_google_conflicts(
    employee_id: str,
    date: str,
    start_time: str,
    end_time: str,
    employee: dict | None = None,
) -> list:
    from core.google_config import GOOGLE_CALENDAR_ENABLED
    if not GOOGLE_CALENDAR_ENABLED:
        return []

    if employee is None:
        employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee or not employee.get("google_calendar_connected"):
        return []

    google_email = employee.get("google_calendar_email") or employee["email"]
    from services.google_calendar import check_google_availability
    return await check_google_availability(google_email, date, start_time, end_time, employee=employee)


async def check_conflicts_bulk(
    employee_id: str, dates: list[str], start_time: str, end_time: str,
    drive_minutes: int, exclude_id: str = None
):
    new_start = time_to_minutes(start_time) - drive_minutes
    new_end = time_to_minutes(end_time) + drive_minutes

    query = {
        "employee_ids": employee_id,
        "date": {"$in": dates},
        "deleted_at": None
    }
    if exclude_id:
        query["id"] = {"$ne": exclude_id}

    logger.debug(
        "Checking bulk conflicts",
        extra={"context": {"dates_count": len(dates)}}
    )

    # Group by date for quick lookup
    from collections import defaultdict
    conflicts_by_date = defaultdict(list)
    seen_count = 0

    async for s in db.schedules.find(query, SCHEDULE_CONFLICT_PROJECTION):
        seen_count += 1
        s_date = s['date']
        s_drive = s.get('drive_time_minutes', 0)
        s_start = time_to_minutes(s['start_time']) - s_drive
        s_end = time_to_minutes(s['end_time']) + s_drive
        if new_start < s_end and new_end > s_start:
            conflicts_by_date[s_date].append({
                "schedule_id": s['id'],
                "location": s.get('location_name', '?'),
                "time": f"{s['start_time']}-{s['end_time']}",
                "overlap": f"Blocks overlap (including {s_drive}m drive)"
            })

    if seen_count > BULK_CONFLICT_LOG_THRESHOLD:
        logger.warning(
            "Large bulk conflict candidate result set",
            extra={"context": {"candidate_count": seen_count}}
        )

    return conflicts_by_date
