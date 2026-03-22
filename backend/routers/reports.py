from datetime import datetime, timezone
from fastapi import APIRouter
from typing import Optional
from collections import defaultdict
from database import db
from core.auth import CurrentUser
from services.schedule_utils import calculate_class_minutes
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["reports"])


@router.get("/dashboard/stats")
async def get_dashboard_stats(user: CurrentUser):
    total_employees = await db.employees.count_documents({"deleted_at": None})
    total_locations = await db.locations.count_documents({"deleted_at": None})
    total_schedules = await db.schedules.count_documents({"deleted_at": None})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_schedules = await db.schedules.count_documents(
        {"date": today, "deleted_at": None}
    )
    return {
        "total_employees": total_employees,
        "total_locations": total_locations,
        "total_schedules": total_schedules,
        "today_schedules": today_schedules,
    }


@router.get("/workload")
async def get_workload_stats(user: CurrentUser):
    employees = await db.employees.find({"deleted_at": None}, {"_id": 0}).to_list(100)
    all_schedules = await db.schedules.find({"deleted_at": None}, {"_id": 0}).to_list(
        1000
    )

    schedules_by_employee = defaultdict(list)
    for s in all_schedules:
        schedules_by_employee[s.get("employee_id")].append(s)

    workload = []
    for emp in employees:
        emp_schedules = schedules_by_employee.get(emp["id"], [])
        total_class_mins = 0
        total_drive_mins = 0
        class_breakdown = {}
        completed = 0
        upcoming = 0
        for s in emp_schedules:
            status = s.get("status", "upcoming")
            if status == "completed":
                completed += 1
            elif status == "upcoming":
                upcoming += 1
            try:
                sh, sm = s["start_time"].split(":")
                eh, em = s["end_time"].split(":")
                class_minutes = (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
                total_class_mins += class_minutes
            except (ValueError, KeyError):
                class_minutes = 0
            drive_minutes = s.get("drive_time_minutes", 0) * 2
            total_drive_mins += drive_minutes

            class_key = (
                s.get("class_id") or f"archived::{s.get('class_name') or 'Unassigned'}"
            )
            if class_key not in class_breakdown:
                class_breakdown[class_key] = {
                    "class_id": s.get("class_id"),
                    "class_name": s.get("class_name") or "Unassigned",
                    "class_color": s.get("class_color") or "#94A3B8",
                    "classes": 0,
                    "class_minutes": 0,
                    "drive_minutes": 0,
                }

            class_breakdown[class_key]["classes"] += 1
            class_breakdown[class_key]["class_minutes"] += class_minutes
            class_breakdown[class_key]["drive_minutes"] += drive_minutes

        workload.append(
            {
                "employee_id": emp["id"],
                "employee_name": emp["name"],
                "employee_color": emp.get("color", "#4F46E5"),
                "total_classes": len(emp_schedules),
                "total_class_hours": round(total_class_mins / 60, 1),
                "total_drive_hours": round(total_drive_mins / 60, 1),
                "completed": completed,
                "upcoming": upcoming,
                "class_breakdown": sorted(
                    [
                        {
                            **class_data,
                            "class_hours": round(class_data["class_minutes"] / 60, 1),
                            "drive_hours": round(class_data["drive_minutes"] / 60, 1),
                        }
                        for class_data in class_breakdown.values()
                    ],
                    key=lambda class_data: (
                        -class_data["classes"],
                        class_data["class_name"],
                    ),
                ),
            }
        )

    return workload


def _init_employee_summary(emp):
    return {
        "employee_name": emp.get("name", "?"),
        "employee_color": emp.get("color", "#4F46E5"),
        "classes": 0,
        "class_minutes": 0,
        "drive_minutes": 0,
        "locations_visited": set(),
        "days_worked": set(),
        "completed": 0,
        "schedule_details": [],
        "class_breakdown": {},
    }


def _get_class_key_entry(s):
    return {
        "class_id": s.get("class_id"),
        "class_name": s.get("class_name") or "Unassigned",
        "class_color": s.get("class_color") or "#94A3B8",
    }


def _aggregate_schedule(summary, s, class_totals):
    class_minutes = calculate_class_minutes(s["start_time"], s["end_time"])
    drive_minutes = s.get("drive_time_minutes", 0) * 2
    summary["classes"] += 1
    summary["class_minutes"] += class_minutes
    summary["drive_minutes"] += drive_minutes
    summary["locations_visited"].add(s.get("location_name", "?"))
    summary["days_worked"].add(s["date"])
    if s.get("status") == "completed":
        summary["completed"] += 1

    class_key = s.get("class_id") or f"archived::{s.get('class_name') or 'Unassigned'}"
    if class_key not in summary["class_breakdown"]:
        summary["class_breakdown"][class_key] = {
            **_get_class_key_entry(s),
            "classes": 0,
            "class_minutes": 0,
            "drive_minutes": 0,
        }
    if class_key not in class_totals:
        class_totals[class_key] = {
            **_get_class_key_entry(s),
            "classes": 0,
            "class_minutes": 0,
        }

    summary["class_breakdown"][class_key]["classes"] += 1
    summary["class_breakdown"][class_key]["class_minutes"] += class_minutes
    summary["class_breakdown"][class_key]["drive_minutes"] += drive_minutes
    class_totals[class_key]["classes"] += 1
    class_totals[class_key]["class_minutes"] += class_minutes

    summary["schedule_details"].append(
        {
            "date": s["date"],
            "location": s.get("location_name", "?"),
            "time": f"{s['start_time']}-{s['end_time']}",
            "drive_minutes": s.get("drive_time_minutes", 0),
            "status": s.get("status", "upcoming"),
            **_get_class_key_entry(s),
        }
    )


def _finalize_summaries(employee_summaries, class_totals):
    result = []
    for summary in employee_summaries.values():
        summary["locations_visited"] = list(summary["locations_visited"])
        summary["days_worked"] = len(summary["days_worked"])
        summary["class_hours"] = round(summary["class_minutes"] / 60, 1)
        summary["drive_hours"] = round(summary["drive_minutes"] / 60, 1)
        summary["class_breakdown"] = sorted(
            [
                {
                    **cd,
                    "class_hours": round(cd["class_minutes"] / 60, 1),
                    "drive_hours": round(cd["drive_minutes"] / 60, 1),
                }
                for cd in summary["class_breakdown"].values()
            ],
            key=lambda cd: (-cd["classes"], cd["class_name"]),
        )
        result.append(summary)

    total_classes = sum(s["classes"] for s in result)
    total_drive_hrs = sum(s["drive_hours"] for s in result)
    total_class_hrs = sum(s["class_hours"] for s in result)

    finalized_class_totals = sorted(
        [
            {**cd, "class_hours": round(cd["class_minutes"] / 60, 1)}
            for cd in class_totals.values()
        ],
        key=lambda cd: (-cd["classes"], cd["class_name"]),
    )

    return (
        result,
        total_classes,
        total_class_hrs,
        total_drive_hrs,
        finalized_class_totals,
    )


@router.get("/reports/weekly-summary")
async def get_weekly_summary(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    class_id: Optional[str] = None,
):
    from datetime import date as dt_date, timedelta as td

    if not date_from:
        today = dt_date.today()
        start = today - td(days=today.weekday())
        date_from = start.isoformat()
        date_to = (start + td(days=6)).isoformat()

    logger.info(
        f"Generating weekly summary report: {date_from} to {date_to}",
        extra={
            "context": {
                "date_from": date_from,
                "date_to": date_to,
                "class_id": class_id,
            }
        },
    )

    query = {"date": {"$gte": date_from, "$lte": date_to}, "deleted_at": None}
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(query, {"_id": 0}).to_list(1000)
    employees = await db.employees.find({"deleted_at": None}, {"_id": 0}).to_list(100)
    emp_map = {e["id"]: e for e in employees}

    employee_summaries = {}
    class_totals = {}
    for s in schedules:
        eid = s["employee_id"]
        if eid not in employee_summaries:
            employee_summaries[eid] = _init_employee_summary(emp_map.get(eid, {}))
        _aggregate_schedule(employee_summaries[eid], s, class_totals)

    result, total_classes, total_class_hrs, total_drive_hrs, finalized_class_totals = (
        _finalize_summaries(employee_summaries, class_totals)
    )

    return {
        "period": {"from": date_from, "to": date_to},
        "totals": {
            "classes": total_classes,
            "class_hours": total_class_hrs,
            "drive_hours": total_drive_hrs,
            "employees_active": len(result),
        },
        "class_totals": finalized_class_totals,
        "employees": sorted(result, key=lambda x: x["classes"], reverse=True),
    }
