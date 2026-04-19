import asyncio
import io
from datetime import datetime, timezone
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from typing import Optional
from collections import defaultdict
from database import db
from core.auth import CurrentUser
from services.schedule_utils import calculate_class_minutes
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["reports"])


@router.get("/dashboard/stats", summary="Get dashboard statistics")
async def get_dashboard_stats(user: CurrentUser):
    """Return total counts for employees, locations, schedules, and today's schedule count."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    (
        total_employees,
        total_locations,
        total_schedules,
        total_classes,
        today_schedules,
    ) = await asyncio.gather(
        db.employees.count_documents({"deleted_at": None}),
        db.locations.count_documents({"deleted_at": None}),
        db.schedules.count_documents({"deleted_at": None}),
        db.classes.count_documents({"deleted_at": None}),
        db.schedules.count_documents({"date": today, "deleted_at": None}),
    )
    return {
        "total_employees": total_employees,
        "total_locations": total_locations,
        "total_schedules": total_schedules,
        "total_classes": total_classes,
        "today_schedules": today_schedules,
    }


def _process_schedule_for_workload(s, workload_data, class_breakdown):
    status = s.get("status", "upcoming")
    if status == "completed":
        workload_data["completed"] += 1
    elif status == "upcoming":
        workload_data["upcoming"] += 1

    try:
        sh, sm = s["start_time"].split(":")
        eh, em = s["end_time"].split(":")
        class_minutes = (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
    except (ValueError, KeyError):
        class_minutes = 0

    workload_data["total_class_mins"] += class_minutes
    drive_minutes = s.get("drive_time_minutes", 0) * 2
    workload_data["total_drive_mins"] += drive_minutes

    class_key = s.get("class_id") or f"archived::{s.get('class_name') or 'Unassigned'}"
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


async def _compute_workload_stats() -> list[dict]:
    """Build the workload payload. Extracted for cacheability."""
    employees, all_schedules = await asyncio.gather(
        db.employees.find(
            {"deleted_at": None},
            {"_id": 0, "id": 1, "name": 1, "color": 1},
        ).to_list(100),
        db.schedules.find(
            {"deleted_at": None},
            {
                "_id": 0,
                "id": 1,
                "employee_ids": 1,
                "status": 1,
                "start_time": 1,
                "end_time": 1,
                "drive_time_minutes": 1,
                "class_id": 1,
                "class_name": 1,
                "class_color": 1,
            },
        ).to_list(1000),
    )

    schedules_by_employee = defaultdict(list)
    for s in all_schedules:
        for eid in s.get("employee_ids", []):
            schedules_by_employee[eid].append(s)

    workload = []
    for emp in employees:
        emp_schedules = schedules_by_employee.get(emp["id"], [])

        data = {
            "total_class_mins": 0,
            "total_drive_mins": 0,
            "completed": 0,
            "upcoming": 0,
        }
        class_breakdown = {}

        for s in emp_schedules:
            _process_schedule_for_workload(s, data, class_breakdown)

        workload.append(
            {
                "employee_id": emp["id"],
                "employee_name": emp["name"],
                "employee_color": emp.get("color", "#4F46E5"),
                "total_classes": len(emp_schedules),
                "total_class_hours": round(data["total_class_mins"] / 60, 1),
                "total_drive_hours": round(data["total_drive_mins"] / 60, 1),
                "completed": data["completed"],
                "upcoming": data["upcoming"],
                "class_breakdown": sorted(
                    [
                        {
                            **class_data,
                            "class_hours": round(class_data["class_minutes"] / 60, 1),
                            "drive_hours": round(class_data["drive_minutes"] / 60, 1),
                        }
                        for class_data in class_breakdown.values()
                    ],
                    key=lambda cd: (-cd["classes"], cd["class_name"]),
                ),
            }
        )

    return workload


@router.get("/workload", summary="Get employee workload statistics")
async def get_workload_stats(user: CurrentUser):
    """Return class/drive hours, completion status, and class breakdowns per employee.

    Served from a 60-second Redis cache when available. Cache is busted
    by mutation endpoints in schedule_crud / schedule_bulk /
    schedule_import / classes / employees (see services.workload_cache).
    """
    from services.workload_cache import get_or_compute
    return await get_or_compute(_compute_workload_stats)


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


async def _compute_weekly_summary(
    date_from: Optional[str], date_to: Optional[str], class_id: Optional[str],
) -> dict:
    """Shared aggregator used by both the JSON and PDF endpoints."""
    from datetime import date as dt_date, timedelta as td

    if not date_from:
        today = dt_date.today()
        start = today - td(days=today.weekday())
        date_from = start.isoformat()
        date_to = (start + td(days=6)).isoformat()

    query = {"date": {"$gte": date_from, "$lte": date_to}, "deleted_at": None}
    if class_id:
        query["class_id"] = class_id

    schedules = await db.schedules.find(query, {"_id": 0}).to_list(1000)
    employees = await db.employees.find({"deleted_at": None}, {"_id": 0}).to_list(100)
    emp_map = {e["id"]: e for e in employees}

    employee_summaries = {}
    class_totals = {}
    for s in schedules:
        for eid in s.get("employee_ids", []):
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


@router.get("/reports/weekly-summary", summary="Get weekly summary report")
async def get_weekly_summary(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    class_id: Optional[str] = None,
):
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
    return await _compute_weekly_summary(date_from, date_to, class_id)


def _render_weekly_summary_pdf(data: dict) -> bytes:
    """Render the weekly summary dict into a PDF using reportlab."""
    # Imported lazily so the module still loads if reportlab isn't
    # available at test time (e.g. in a minimal dev environment).
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter,
        leftMargin=0.6 * inch, rightMargin=0.6 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title="Weekly Summary",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "H1", parent=styles["Heading1"], fontSize=18, spaceAfter=6,
    )
    h2 = ParagraphStyle(
        "H2", parent=styles["Heading2"], fontSize=13, spaceAfter=4,
    )
    body = styles["BodyText"]

    period = data.get("period", {})
    totals = data.get("totals", {})
    story = []
    story.append(Paragraph("Iowa Center — Weekly Summary", h1))
    story.append(Paragraph(
        f"Period: {period.get('from', '?')} \u2013 {period.get('to', '?')}", body,
    ))
    story.append(Paragraph(
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        body,
    ))
    story.append(Spacer(1, 0.2 * inch))

    story.append(Paragraph("Totals", h2))
    totals_table = Table(
        [
            ["Classes", totals.get("classes", 0)],
            ["Class hours", totals.get("class_hours", 0)],
            ["Drive hours", totals.get("drive_hours", 0)],
            ["Employees active", totals.get("employees_active", 0)],
        ],
        colWidths=[2.5 * inch, 1.5 * inch],
    )
    totals_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.lightgrey),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
    ]))
    story.append(totals_table)
    story.append(Spacer(1, 0.25 * inch))

    class_totals = data.get("class_totals") or []
    if class_totals:
        story.append(Paragraph("By class", h2))
        rows = [["Class", "Sessions", "Hours"]]
        for ct in class_totals:
            rows.append([
                ct.get("class_name", "\u2014"),
                ct.get("classes", 0),
                ct.get("class_hours", 0),
            ])
        t = Table(rows, colWidths=[3.5 * inch, 1 * inch, 1 * inch], repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.25 * inch))

    employees = data.get("employees") or []
    if employees:
        story.append(Paragraph("By employee", h2))
        rows = [["Name", "Classes", "Class hrs", "Drive hrs"]]
        for emp in employees:
            rows.append([
                emp.get("name", "\u2014"),
                emp.get("classes", 0),
                emp.get("class_hours", 0),
                emp.get("drive_hours", 0),
            ])
        t = Table(
            rows,
            colWidths=[2.8 * inch, 1 * inch, 1 * inch, 1 * inch],
            repeatRows=1,
        )
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ]))
        story.append(t)

    if not class_totals and not employees:
        story.append(Paragraph("No activity in this period.", body))

    doc.build(story)
    return buffer.getvalue()


@router.get(
    "/reports/weekly-summary.pdf",
    summary="Download the weekly summary as a PDF",
)
async def get_weekly_summary_pdf(
    user: CurrentUser,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    class_id: Optional[str] = None,
):
    data = await _compute_weekly_summary(date_from, date_to, class_id)
    # reportlab.build is CPU-bound but typically sub-second on these
    # volumes — keep it in-thread to avoid the overhead of a worker hop.
    pdf_bytes = _render_weekly_summary_pdf(data)
    period = data["period"]
    filename = f"weekly_summary_{period['from']}_to_{period['to']}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Coordination Reports ──────────────────────────────────────────────


@router.get("/coordination/summary", summary="Coordination top-level metrics")
async def coordination_summary(user: CurrentUser):
    all_projects = await db.projects.find({"deleted_at": None}, {"_id": 0}).to_list(2000)
    completed = [p for p in all_projects if p.get("phase") == "complete"]
    active_partners = await db.partner_orgs.count_documents(
        {"deleted_at": None, "status": "active"}
    )
    return {
        "classes_delivered": len(completed),
        "total_attendance": sum(p.get("attendance_count") or 0 for p in completed),
        "warm_leads": sum(p.get("warm_leads") or 0 for p in completed),
        "active_partners": active_partners,
        "total_projects": len(all_projects),
    }


@router.get("/coordination/by-community", summary="Per-community coordination breakdown")
async def coordination_by_community(user: CurrentUser):
    all_projects = await db.projects.find({"deleted_at": None}, {"_id": 0}).to_list(2000)
    communities = {}
    for p in all_projects:
        c = p.get("community", "Unknown")
        if c not in communities:
            communities[c] = {
                "community": c, "delivered": 0, "upcoming": 0,
                "attendance": 0, "warm_leads": 0,
            }
        if p.get("phase") == "complete":
            communities[c]["delivered"] += 1
            communities[c]["attendance"] += p.get("attendance_count") or 0
            communities[c]["warm_leads"] += p.get("warm_leads") or 0
        else:
            communities[c]["upcoming"] += 1
    return {"communities": list(communities.values())}


def _compute_health(completion_rate, last_active, classes_hosted):
    """Compute composite health score and tier."""
    recency_score = 0
    if last_active:
        days_since = (
            datetime.now(timezone.utc)
            - datetime.fromisoformat(last_active)
        ).days
        if days_since <= 7:
            recency_score = 100
        elif days_since <= 30:
            recency_score = 70
        elif days_since <= 60:
            recency_score = 40
        else:
            recency_score = 10

    hosted_score = min(classes_hosted * 20, 100)
    health_score = round(
        completion_rate * 0.4
        + recency_score * 0.3
        + hosted_score * 0.3,
        1,
    )
    if health_score >= 80:
        tier = "excellent"
    elif health_score >= 60:
        tier = "good"
    elif health_score >= 40:
        tier = "needs_attention"
    else:
        tier = "at_risk"
    return health_score, tier


@router.get("/coordination/partner-health", summary="Partner health table")
async def coordination_partner_health(user: CurrentUser):
    orgs = await db.partner_orgs.find(
        {"deleted_at": None}, {"_id": 0},
    ).to_list(500)
    results = []
    for org in orgs:
        projects = await db.projects.find(
            {
                "partner_org_id": org["id"],
                "deleted_at": None,
            },
            {"_id": 0, "id": 1, "phase": 1, "updated_at": 1},
        ).to_list(500)
        project_ids = [p["id"] for p in projects]
        total_tasks = 0
        completed_tasks = 0
        if project_ids:
            tasks = await db.tasks.find(
                {"project_id": {"$in": project_ids}, "deleted_at": None},
                {"_id": 0, "completed": 1, "completed_at": 1},
            ).to_list(5000)
            total_tasks = len(tasks)
            completed_tasks = sum(1 for t in tasks if t.get("completed"))

        completion_rate = round((completed_tasks / total_tasks * 100), 1) if total_tasks > 0 else 0
        classes_hosted = sum(1 for p in projects if p.get("phase") == "complete")
        last_active = max(
            (p.get("updated_at") for p in projects if p.get("updated_at")),
            default=None,
        )
        health_score, health_tier = _compute_health(
            completion_rate, last_active, classes_hosted,
        )

        results.append({
            "partner_org_id": org["id"],
            "name": org["name"],
            "community": org.get("community", ""),
            "status": org.get("status", ""),
            "classes_hosted": classes_hosted,
            "completion_rate": completion_rate,
            "last_active": last_active,
            "health_score": health_score,
            "health_tier": health_tier,
        })
    return {"partners": results}


@router.get(
    "/coordination/conversion-funnel",
    summary="Aggregate conversion funnel across projects",
)
async def coordination_conversion_funnel(user: CurrentUser):
    outcomes = await db.event_outcomes.find(
        {"deleted_at": None}, {"_id": 0, "status": 1},
    ).to_list(50000)
    total = len(outcomes)
    counts = {
        "attended": 0, "contacted": 0, "consultation": 0,
        "converted": 0, "lost": 0,
    }
    for o in outcomes:
        s = o.get("status", "attended")
        if s in counts:
            counts[s] += 1
    conversion_rate = (
        round(counts["converted"] / total * 100, 1)
        if total > 0 else 0
    )
    return {"total": total, **counts, "conversion_rate": conversion_rate}
