import calendar
from typing import Optional
from database import db
from models.schemas import RecurrenceRule, ScheduleCreate
from core.logger import get_logger

logger = get_logger(__name__)


def time_to_minutes(time_str: str) -> int:
    h, m = time_str.split(':')
    return int(h) * 60 + int(m)


def calculate_class_minutes(start_time: str, end_time: str) -> int:
    return time_to_minutes(end_time) - time_to_minutes(start_time)


def add_months(source_date, months: int):
    month_index = source_date.month - 1 + months
    year = source_date.year + (month_index // 12)
    month = month_index % 12 + 1
    day = min(source_date.day, calendar.monthrange(year, month)[1])
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


def _build_monthly_dates(start_date, interval, occurrence_limit, end_date):
    dates = []
    current = start_date
    while True:
        if end_date and current > end_date:
            break
        dates.append(current.isoformat())
        if occurrence_limit and len(dates) >= occurrence_limit:
            break
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

    query = {"employee_id": employee_id, "date": date, "deleted_at": None}
    if exclude_id:
        query["id"] = {"$ne": exclude_id}

    logger.debug(
        "Checking conflicts",
        extra={"context": {"employee_id": employee_id, "date": date}}
    )

    existing = await db.schedules.find(query, {"_id": 0}).to_list(100)

    conflicts = []
    for s in existing:
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
    return conflicts


async def check_outlook_conflicts(employee_id: str, date: str, start_time: str, end_time: str) -> list:
    from core.outlook_config import OUTLOOK_CALENDAR_ENABLED
    if not OUTLOOK_CALENDAR_ENABLED:
        return []

    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee or not employee.get("email"):
        return []

    from services.outlook import check_outlook_availability
    return await check_outlook_availability(employee["email"], date, start_time, end_time, employee=employee)


async def check_google_conflicts(employee_id: str, date: str, start_time: str, end_time: str) -> list:
    from core.google_config import GOOGLE_CALENDAR_ENABLED
    if not GOOGLE_CALENDAR_ENABLED:
        return []

    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee or not employee.get("email"):
        return []

    from services.google_calendar import check_google_availability
    return await check_google_availability(employee["email"], date, start_time, end_time, employee=employee)


async def check_conflicts_bulk(
    employee_id: str, dates: list[str], start_time: str, end_time: str,
    drive_minutes: int, exclude_id: str = None
):
    new_start = time_to_minutes(start_time) - drive_minutes
    new_end = time_to_minutes(end_time) + drive_minutes

    query = {
        "employee_id": employee_id,
        "date": {"$in": dates},
        "deleted_at": None
    }
    if exclude_id:
        query["id"] = {"$ne": exclude_id}

    logger.debug(
        "Checking bulk conflicts",
        extra={"context": {"employee_id": employee_id, "dates_count": len(dates)}}
    )

    # We might have many schedules, let's use a larger limit
    existing = await db.schedules.find(query, {"_id": 0}).to_list(10000)

    # Group by date for quick lookup
    from collections import defaultdict
    conflicts_by_date = defaultdict(list)

    for s in existing:
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

    return conflicts_by_date
