import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import ProjectCreate, ProjectUpdate, PhaseAdvanceRequest
from core.auth import CurrentUser, SchedulerRequired
from core.constants import PROJECT_PHASES, PROJECT_PHASE_ORDER, ROLE_ADMIN
from core.pagination import Paginated, paginated_response
from services.activity import log_activity
from services.notification_events import (
    notify_project_deleted,
    notify_project_phase_advanced,
)
from services.workload_cache import invalidate as invalidate_workload_cache
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_NOT_FOUND = "Project not found"
PARTNER_ORG_NOT_FOUND = "Partner organization not found"


async def _resolve_partner_data(partner_org_id: str):
    """Fetch partner org and its linked location. Returns (org, location_or_None)."""
    org = await db.partner_orgs.find_one(
        {"id": partner_org_id, "deleted_at": None}, {"_id": 0}
    )
    if not org:
        raise HTTPException(status_code=400, detail=PARTNER_ORG_NOT_FOUND)
    location = None
    if org.get("location_id"):
        location = await db.locations.find_one(
            {"id": org["location_id"], "deleted_at": None}, {"_id": 0}
        )
    return org, location
NO_FIELDS_TO_UPDATE = "No fields to update"

# ── Templates ─────────────────────────────────────────────────────────

templates_router = APIRouter(prefix="/project-templates", tags=["projects"])


@templates_router.get("", summary="List project templates")
async def list_templates(user: CurrentUser):
    templates = await db.project_templates.find({}, {"_id": 0}).to_list(50)
    return {"items": templates, "total": len(templates)}


# ── Helpers ───────────────────────────────────────────────────────────

_EMPTY_STATS = {"total": 0, "completed": 0, "partner_overdue": 0}
_AGG_MATCH = "$match"
_AGG_GROUP = "$group"
_AGG_IF_NULL = "$ifNull"
_AGG_COUNT = "$count"
_AGG_COND = "$cond"
_ATTENDANCE_FIELD = "$attendance_count"
_WARM_LEADS_FIELD = "$warm_leads"
_CLASS_ID_FIELD = "$class_id"


async def _build_task_stats(project_ids: list[str]) -> dict:
    """Fetch tasks for the given project IDs and return per-project stats.

    Uses a server-side `$group` aggregation so we never pull individual
    task documents back for the board view — the previous approach read
    up to 10k tasks into memory and looped in Python. Here Mongo returns
    one row per project, regardless of task volume.
    """
    if not project_ids:
        return {}
    now = datetime.now(timezone.utc).isoformat()
    pipeline = [
        {_AGG_MATCH: {"project_id": {"$in": project_ids}, "deleted_at": None}},
        {
            _AGG_GROUP: {
                "_id": "$project_id",
                "total": {"$sum": 1},
                "completed": {
                    "$sum": {_AGG_COND: [{"$eq": ["$completed", True]}, 1, 0]},
                },
                "partner_overdue": {
                    "$sum": {
                        _AGG_COND: [
                            {
                                "$and": [
                                    {"$ne": ["$completed", True]},
                                    {"$in": [{_AGG_IF_NULL: ["$owner", ""]}, ["partner", "both"]]},
                                    {"$lt": [{_AGG_IF_NULL: ["$due_date", ""]}, now]},
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]
    stats: dict = {}
    async for row in db.tasks.aggregate(pipeline):
        stats[row["_id"]] = {
            "total": row.get("total", 0),
            "completed": row.get("completed", 0),
            "partner_overdue": row.get("partner_overdue", 0),
        }
    return stats


# ── Projects ──────────────────────────────────────────────────────────


_BOARD_PHASE_LIMIT_DEFAULT = 50
_BOARD_PHASE_LIMIT_MAX = 200


def _phase_match(phase: str) -> dict:
    """Build the phase predicate for a single board column.

    The legacy implementation used ``phase != complete`` then defaulted
    ``phase.get("phase", "planning")`` in Python, so legacy/imported
    projects with a null or missing ``phase`` field rendered under
    Planning. The exact-equality queries we use for the paged fetches
    would silently hide those records, so the Planning predicate is
    widened to also match null / missing / empty values.
    """
    if phase == "planning":
        return {
            "$or": [
                {"phase": "planning"},
                {"phase": {"$in": [None, ""]}},
                {"phase": {"$exists": False}},
            ],
        }
    return {"phase": phase}


async def _fetch_phase_projects(
    base_query: dict, phase: str, limit: int,
) -> tuple[str, list, bool]:
    """Load the newest ``limit`` projects for a single phase.

    Overfetches by one document to detect whether more rows exist beyond
    the page boundary without a second count query. The extra row is
    discarded before returning; the flag tells the caller whether the
    UI should display a "more available" indicator for that column.
    """
    phase_query = {**base_query, **_phase_match(phase)}
    rows = (
        await db.projects.find(phase_query, {"_id": 0})
        .sort("updated_at", -1)
        .limit(limit + 1)
        .to_list(limit + 1)
    )
    truncated = len(rows) > limit
    return phase, rows[:limit], truncated


@router.get("/board", summary="Portfolio kanban board")
async def get_project_board(
    user: CurrentUser,
    community: Optional[str] = None,
    event_format: Optional[str] = None,
    class_id: Optional[str] = None,
    phase_limit: int = _BOARD_PHASE_LIMIT_DEFAULT,
):
    # Clamp phase_limit so a caller can't force a full-collection scan
    # by passing e.g. phase_limit=10**9. The previous implementation
    # loaded up to 500 projects total with no per-column bound.
    phase_limit = max(1, min(phase_limit, _BOARD_PHASE_LIMIT_MAX))

    query: dict = {"deleted_at": None}
    if community:
        query["community"] = community
    if event_format:
        query["event_format"] = event_format
    if class_id:
        query["class_id"] = class_id

    active_phases = [p for p in PROJECT_PHASES if p != "complete"]
    # Facet query runs against the full active-project set (not the
    # paged columns) so the filter dropdown stays complete even when a
    # phase is truncated — otherwise users couldn't narrow the filters
    # to reach projects that landed past the cap.
    facets_query = {**query, "phase": {"$ne": "complete"}}

    # Fan one paged query out per phase in parallel plus the facets
    # query. Each phase query is bounded at phase_limit+1 and hits the
    # existing `phase` index.
    tasks = [
        _fetch_phase_projects(query, phase, phase_limit) for phase in active_phases
    ]
    tasks.append(db.projects.distinct("community", facets_query))
    results = await asyncio.gather(*tasks)
    phase_results = results[: len(active_phases)]
    community_facets = results[-1]

    all_ids = [p["id"] for _, rows, _ in phase_results for p in rows]
    task_stats = await _build_task_stats(all_ids)

    columns: dict[str, list] = {phase: [] for phase in active_phases}
    phase_truncated: dict[str, bool] = {}
    for phase, rows, truncated in phase_results:
        phase_truncated[phase] = truncated
        for p in rows:
            stats = task_stats.get(p["id"], _EMPTY_STATS)
            p["task_total"] = stats["total"]
            p["task_completed"] = stats["completed"]
            p["partner_overdue"] = stats["partner_overdue"]
        columns[phase] = rows

    return {
        "columns": columns,
        "phase_truncated": phase_truncated,
        "phase_limit": phase_limit,
        "facets": {
            "communities": sorted(c for c in community_facets if c),
        },
    }


async def _aggregate_completed_metrics() -> dict:
    """Return completed count and totals from Mongo aggregation."""
    pipeline = [
        {_AGG_MATCH: {"deleted_at": None, "phase": "complete"}},
        {
            _AGG_GROUP: {
                "_id": None,
                "classes_delivered": {"$sum": 1},
                "total_attendance": {
                    "$sum": {_AGG_IF_NULL: [_ATTENDANCE_FIELD, 0]},
                },
                "warm_leads": {"$sum": {_AGG_IF_NULL: [_WARM_LEADS_FIELD, 0]}},
            },
        },
    ]
    rows = await db.projects.aggregate(pipeline).to_list(1)
    if not rows:
        return {"classes_delivered": 0, "total_attendance": 0, "warm_leads": 0}
    row = rows[0]
    return {
        "classes_delivered": row.get("classes_delivered", 0),
        "total_attendance": row.get("total_attendance", 0),
        "warm_leads": row.get("warm_leads", 0),
    }


async def _aggregate_community_breakdown() -> list:
    """Group projects by community with delivery/upcoming and phase stats."""
    pipeline = [
        {_AGG_MATCH: {"deleted_at": None}},
        {
            _AGG_GROUP: {
                "_id": {
                    "community": {_AGG_IF_NULL: ["$community", "Unknown"]},
                    "phase": {_AGG_IF_NULL: ["$phase", "planning"]},
                },
                "count": {"$sum": 1},
                "attendance": {"$sum": {_AGG_IF_NULL: [_ATTENDANCE_FIELD, 0]}},
                "warm_leads": {"$sum": {_AGG_IF_NULL: [_WARM_LEADS_FIELD, 0]}},
            },
        },
        {
            _AGG_GROUP: {
                "_id": "$_id.community",
                "parts": {
                    "$push": {
                        "phase": "$_id.phase",
                        "count": "$count",
                        "attendance": "$attendance",
                        "warm_leads": "$warm_leads",
                    },
                },
            },
        },
    ]
    rows = []
    async for row in db.projects.aggregate(pipeline):
        rows.append(row)
    communities: list = []
    for row in rows:
        info = {
            "community": row["_id"],
            "delivered": 0,
            "upcoming": 0,
            "attendance": 0,
            "warm_leads": 0,
            "phases": {},
        }
        for part in row.get("parts", []):
            phase = part.get("phase", "planning")
            count = part.get("count", 0)
            if phase == "complete":
                info["delivered"] += count
                info["attendance"] += part.get("attendance", 0)
                info["warm_leads"] += part.get("warm_leads", 0)
            else:
                info["upcoming"] += count
                info["phases"][phase] = info["phases"].get(phase, 0) + count
        communities.append(info)
    return communities


async def _aggregate_class_breakdown() -> tuple[dict, list[str]]:
    """Group completed projects by class_id. Returns (breakdown, class_ids)."""
    pipeline = [
        {_AGG_MATCH: {"deleted_at": None, "phase": "complete"}},
        {
            _AGG_GROUP: {
                "_id": {
                    _AGG_COND: [
                        {
                            "$or": [
                                {"$eq": [_CLASS_ID_FIELD, None]},
                                {"$eq": [_CLASS_ID_FIELD, ""]},
                            ],
                        },
                        "unlinked",
                        _CLASS_ID_FIELD,
                    ],
                },
                "delivered": {"$sum": 1},
                "attendance": {"$sum": {_AGG_IF_NULL: [_ATTENDANCE_FIELD, 0]}},
                "warm_leads": {"$sum": {_AGG_IF_NULL: [_WARM_LEADS_FIELD, 0]}},
            },
        },
    ]
    rows = []
    async for row in db.projects.aggregate(pipeline):
        rows.append(row)
    breakdown: dict = {}
    for row in rows:
        cid = row["_id"]
        breakdown[cid] = {
            "class_id": cid if cid != "unlinked" else None,
            "delivered": row.get("delivered", 0),
            "attendance": row.get("attendance", 0),
            "warm_leads": row.get("warm_leads", 0),
        }
    class_ids = [k for k in breakdown if k != "unlinked"]
    return breakdown, class_ids


async def _enrich_class_breakdown(breakdown: dict, class_ids: list[str]) -> None:
    """Add class_name and class_color from the classes collection."""
    if not class_ids:
        if "unlinked" in breakdown:
            breakdown["unlinked"]["class_name"] = "No class linked"
        return
    class_docs = await db.classes.find(
        {"id": {"$in": class_ids}}, {"_id": 0, "id": 1, "name": 1, "color": 1}
    ).to_list(100)
    class_map = {c["id"]: c for c in class_docs}
    for cid, info in breakdown.items():
        doc = class_map.get(cid)
        if doc:
            info["class_name"] = doc.get("name", "Unknown")
            info["class_color"] = doc.get("color")
        elif cid == "unlinked":
            info["class_name"] = "No class linked"


async def _count_orphan_schedules() -> int:
    """Count completed schedules that have no linked non-deleted project."""
    pipeline = [
        {_AGG_MATCH: {"status": "completed", "deleted_at": None}},
        {
            "$lookup": {
                "from": "projects",
                "localField": "id",
                "foreignField": "schedule_id",
                "as": "linked_projects",
            },
        },
        {
            "$addFields": {
                "active_link_count": {
                    "$size": {
                        "$filter": {
                            "input": "$linked_projects",
                            "as": "p",
                            "cond": {"$eq": ["$$p.deleted_at", None]},
                        },
                    },
                },
            },
        },
        {_AGG_MATCH: {"active_link_count": 0}},
        {_AGG_COUNT: "count"},
    ]
    rows = await db.schedules.aggregate(pipeline).to_list(1)
    if not rows:
        return 0
    return rows[0].get("count", 0)


async def _count_overdue_tasks_for_upcoming_projects(now_iso: str) -> int:
    """Count overdue open tasks linked to non-complete, non-deleted projects."""
    pipeline = [
        {_AGG_MATCH: {"completed": False, "due_date": {"$lt": now_iso}, "deleted_at": None}},
        {
            "$lookup": {
                "from": "projects",
                "localField": "project_id",
                "foreignField": "id",
                "as": "project_docs",
            },
        },
        {
            _AGG_MATCH: {
                "project_docs": {
                    "$elemMatch": {"deleted_at": None, "phase": {"$ne": "complete"}},
                },
            },
        },
        {_AGG_COUNT: "count"},
    ]
    rows = await db.tasks.aggregate(pipeline).to_list(1)
    if not rows:
        return 0
    return rows[0].get("count", 0)


_DASHBOARD_AGG_FIELDS = {
    "_id": 0, "id": 1, "phase": 1, "community": 1, "event_date": 1,
    "attendance_count": 1, "warm_leads": 1, "class_id": 1, "schedule_id": 1,
}
_DASHBOARD_PROJECT_LIMIT = 5000


@router.get("/dashboard", summary="Multi-community dashboard metrics")
async def get_dashboard(
    user: CurrentUser, period: int = 90,
):
    # Slim projection — only the fields the in-memory aggregations below
    # actually read. Full upcoming-project records are fetched separately
    # (DB-side sort + limit 20) so we don't pay for fields we won't use.
    all_projects = await db.projects.find(
        {"deleted_at": None}, _DASHBOARD_AGG_FIELDS,
    ).to_list(_DASHBOARD_PROJECT_LIMIT)
    truncated = len(all_projects) >= _DASHBOARD_PROJECT_LIMIT
    active_partners = await db.partner_orgs.count_documents(
        {"deleted_at": None, "status": "active"},
    )
    completed_metrics = await _aggregate_completed_metrics()
    upcoming_count = await db.projects.count_documents(
        {"deleted_at": None, "phase": {"$ne": "complete"}},
    )

    overdue_count = 0
    if upcoming_count:
        now = datetime.now(timezone.utc).isoformat()
        overdue_count = await _count_overdue_tasks_for_upcoming_projects(now)

    upcoming_projects = await db.projects.find(
        {"deleted_at": None, "phase": {"$ne": "complete"}}, {"_id": 0},
    ).sort("event_date", 1).limit(20).to_list(20)

    communities = await _aggregate_community_breakdown()
    class_breakdown, class_ids = await _aggregate_class_breakdown()
    await _enrich_class_breakdown(class_breakdown, class_ids)
    orphan_completed = await _count_orphan_schedules()

    return {
        "classes_delivered": completed_metrics["classes_delivered"],
        "total_attendance": completed_metrics["total_attendance"],
        "warm_leads": completed_metrics["warm_leads"],
        "active_partners": active_partners,
        "upcoming_classes": upcoming_count,
        "overdue_alert_count": overdue_count,
        "orphan_completed_schedules": orphan_completed,
        "class_breakdown": list(class_breakdown.values()),
        "communities": communities,
        "upcoming_projects": upcoming_projects,
        "trends": _build_trends(all_projects, period),
        "truncated": truncated,
    }


def _build_trends(projects: list, period_days: int) -> dict:
    """Build monthly trend buckets for delivered classes and attendance."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=period_days)
    ).isoformat()
    recent = [
        p for p in projects
        if p.get("phase") == "complete"
        and (p.get("event_date") or "") >= cutoff
    ]
    months: dict = {}
    for p in recent:
        month = (p.get("event_date") or "")[:7]  # YYYY-MM
        community = p.get("community", "Unknown")
        if month not in months:
            months[month] = {}
        if community not in months[month]:
            months[month][community] = {
                "delivered": 0, "attendance": 0,
            }
        months[month][community]["delivered"] += 1
        months[month][community]["attendance"] += (
            p.get("attendance_count") or 0
        )
    return {
        "months": sorted(months.keys()),
        "by_month": {
            m: months[m] for m in sorted(months.keys())
        },
    }


@router.get("", summary="List projects")
async def list_projects(
    user: CurrentUser,
    pagination: Paginated,
    community: Optional[str] = None,
    phase: Optional[str] = None,
    event_format: Optional[str] = None,
    partner_org_id: Optional[str] = None,
    class_id: Optional[str] = None,
    schedule_id: Optional[str] = None,
):
    query = {"deleted_at": None}
    if community:
        query["community"] = community
    if phase:
        query["phase"] = phase
    if event_format:
        query["event_format"] = event_format
    if partner_org_id:
        query["partner_org_id"] = partner_org_id
    if class_id:
        query["class_id"] = class_id
    if schedule_id:
        query["schedule_id"] = schedule_id
    total = await db.projects.count_documents(query)
    items = (
        await db.projects.find(query, {"_id": 0})
        .sort("event_date", -1)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .to_list(pagination.limit)
    )
    return paginated_response(items, total, pagination)


async def _clone_template_tasks(
    template_id: str, project_id: str, event_date: str, now: str,
) -> int:
    """Clone tasks from a project template. Returns number of tasks created."""
    template = await db.project_templates.find_one(
        {"id": template_id}, {"_id": 0}
    )
    if not template or not template.get("default_tasks"):
        return 0
    try:
        event_dt = datetime.fromisoformat(event_date)
    except (ValueError, TypeError):
        event_dt = datetime.now(timezone.utc)
    task_docs = []
    for idx, t in enumerate(template["default_tasks"]):
        due_date = event_dt + timedelta(days=t.get("offset_days", 0))
        task_docs.append({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "title": t["title"],
            "phase": t["phase"],
            "owner": t["owner"],
            "assigned_to": None,
            "due_date": due_date.isoformat(),
            "completed": False,
            "completed_at": None,
            "completed_by": None,
            "sort_order": idx,
            "details": t.get("details", ""),
            "description": "",
            "created_at": now,
        })
    if task_docs:
        await db.tasks.insert_many(task_docs)
    return len(task_docs)


async def _auto_create_schedule(
    project_doc: dict, data: ProjectCreate,
    location: dict | None, class_id: str,
    created_by_user_id: str | None = None,
) -> str | None:
    """Auto-create a schedule linked to the project. Returns warning string or None."""
    if not location:
        return "Partner organization has no linked location; schedule not created."
    try:
        from routers.schedule_helpers import (
            _build_schedule_doc, _fetch_employees,
        )

        employees = await _fetch_employees(data.employee_ids)
        class_doc = None
        if class_id:
            class_doc = await db.classes.find_one(
                {"id": class_id, "deleted_at": None}, {"_id": 0}
            )

        sched_date = data.event_date[:10]  # extract YYYY-MM-DD
        drive_time = location.get("drive_time_minutes", 0)

        # Build a lightweight adapter with the fields _build_schedule_doc reads
        class _ScheduleData:
            location_id = location["id"]
            start_time = data.start_time
            end_time = data.end_time
            drive_to_override_minutes = None
            drive_from_override_minutes = None
            notes = None
            recurrence = "none"
            recurrence_end_mode = None
            recurrence_end_date = None
            recurrence_occurrences = None

        sched_doc = _build_schedule_doc(
            _ScheduleData(), sched_date, drive_time,
            False, None,  # town_to_town, warning
            None,  # recurrence_rule
            location, employees, class_doc,
            created_by_user_id=created_by_user_id,
        )
        await db.schedules.insert_one(sched_doc)
        sched_doc.pop("_id", None)

        # Link schedule back to the project
        await db.projects.update_one(
            {"id": project_doc["id"]},
            {"$set": {"schedule_id": sched_doc["id"]}},
        )
        project_doc["schedule_id"] = sched_doc["id"]
        # New schedule means new class/drive hours flowing into /workload.
        await invalidate_workload_cache()
        logger.info(
            "Auto-created schedule for project",
            extra={"entity": {
                "project_id": project_doc["id"],
                "schedule_id": sched_doc["id"],
            }},
        )
        return None
    except Exception as e:
        logger.warning(
            "Failed to auto-create schedule for project",
            extra={"entity": {"project_id": project_doc["id"], "error": str(e)}},
        )
        return f"Schedule could not be created: {e}"


@router.post(
    "",
    summary="Create a project",
    responses={
        400: {"description": "Linked schedule or partner org not found"},
    },
)
async def create_project(data: ProjectCreate, user: SchedulerRequired):
    # Validate and resolve partner org + location
    partner_org, location = await _resolve_partner_data(data.partner_org_id)

    # Derive community from partner org's location, falling back to org.community
    community = data.community
    if not community:
        if location:
            community = location["city_name"]
        else:
            community = partner_org.get("community", "")

    # Derive venue_name from partner org name
    venue_name = data.venue_name or partner_org["name"]

    # Validate linked schedule and auto-fill class_id if not provided
    class_id = data.class_id
    schedule_id = data.schedule_id
    if schedule_id:
        schedule = await db.schedules.find_one(
            {"id": schedule_id, "deleted_at": None},
            {"_id": 0, "id": 1, "class_id": 1},
        )
        if not schedule:
            raise HTTPException(status_code=400, detail="Linked schedule not found")
        if not class_id and schedule.get("class_id"):
            class_id = schedule["class_id"]

    project_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    doc = {
        "id": project_id,
        "title": data.title,
        "event_format": data.event_format,
        "partner_org_id": data.partner_org_id,
        "partner_org_name": partner_org["name"],
        "template_id": data.template_id,
        "schedule_id": schedule_id,
        "class_id": class_id,
        "event_date": data.event_date,
        "phase": "planning",
        "community": community,
        "venue_name": venue_name,
        "venue_details": partner_org.get("venue_details", {}),
        "location_id": partner_org.get("location_id"),
        "registration_count": 0,
        "attendance_count": None,
        "warm_leads": None,
        "notes": "",
        "created_at": now,
        "updated_at": now,
        # Use the JWT payload's canonical user id key (``user_id``).
        # The prior ``user.get("id", "")`` default left every project
        # attributed to the empty string.
        "created_by": user.get("user_id", ""),
        "deleted_at": None,
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)

    # Auto-create schedule if requested
    schedule_warning = None
    if (
        data.auto_create_schedule
        and class_id
        and data.employee_ids
        and data.start_time
        and data.end_time
    ):
        schedule_warning = await _auto_create_schedule(
            doc, data, location, class_id,
            created_by_user_id=user.get("user_id"),
        )

    # Clone tasks from template
    tasks_created = 0
    if data.template_id:
        tasks_created = await _clone_template_tasks(
            data.template_id, project_id, data.event_date, now,
        )

    logger.info("Project created", extra={"entity": {"project_id": project_id}})
    await log_activity(
        "project_created",
        f"Project '{data.title}' created in {community}",
        "project", project_id, user.get("name", "System"),
    )
    doc["tasks_created"] = tasks_created
    if schedule_warning:
        doc["schedule_warning"] = schedule_warning
    return doc


@router.get(
    "/{project_id}",
    summary="Get a single project with task counts",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def get_project(project_id: str, user: CurrentUser):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None}, {"_id": 0}
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    # Task counts per phase
    tasks = await db.tasks.find(
        {"project_id": project_id, "deleted_at": None},
        {"_id": 0, "phase": 1, "completed": 1},
    ).to_list(1000)
    phase_counts = {}
    for phase in PROJECT_PHASES:
        if phase == "complete":
            continue
        phase_tasks = [t for t in tasks if t.get("phase") == phase]
        phase_counts[phase] = {
            "total": len(phase_tasks),
            "completed": sum(1 for t in phase_tasks if t.get("completed")),
        }
    project["task_counts"] = phase_counts
    project["task_total"] = len(tasks)
    project["task_completed"] = sum(1 for t in tasks if t.get("completed"))

    # Enrich with partner org and location data
    org = await db.partner_orgs.find_one(
        {"id": project.get("partner_org_id"), "deleted_at": None},
        {"_id": 0, "name": 1, "community": 1, "location_id": 1,
         "venue_details": 1, "status": 1},
    )
    if org:
        project["partner_org_name"] = org["name"]
        project["partner_org_status"] = org.get("status")
        project["partner_org_venue_details"] = org.get("venue_details", {})
        if org.get("location_id"):
            loc = await db.locations.find_one(
                {"id": org["location_id"], "deleted_at": None},
                {"_id": 0, "city_name": 1, "latitude": 1, "longitude": 1},
            )
            if loc:
                project["location_name"] = loc["city_name"]
                project["location_id"] = org["location_id"]

    return project


@router.put(
    "/{project_id}",
    summary="Update a project",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": PROJECT_NOT_FOUND},
    },
)
async def update_project(project_id: str, data: ProjectUpdate, user: SchedulerRequired):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Re-derive partner-linked fields when partner_org_id changes
    if "partner_org_id" in update_data:
        org = await db.partner_orgs.find_one(
            {"id": update_data["partner_org_id"]}, {"_id": 0}
        )
        if not org:
            raise HTTPException(status_code=400, detail="Partner organization not found")
        update_data["partner_org_name"] = org.get("name", "")
        update_data["venue_name"] = org.get("name", "")
        update_data["community"] = org.get("community", "")
        # Resolve location if partner org has one
        if org.get("location_id"):
            loc = await db.locations.find_one(
                {"id": org["location_id"]}, {"_id": 0}
            )
            if loc:
                update_data["location_id"] = org["location_id"]
                update_data["location_name"] = loc.get("city_name", "")
                update_data["community"] = loc.get("city_name") or org.get("community", "")

    result = await db.projects.update_one(
        {"id": project_id, "deleted_at": None}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    updated = await db.projects.find_one({"id": project_id}, {"_id": 0})
    # Sync event_date to linked schedule if date changed
    if "event_date" in update_data and updated and updated.get("schedule_id"):
        new_date = update_data["event_date"][:10]  # Extract YYYY-MM-DD
        await db.schedules.update_one(
            {"id": updated["schedule_id"], "deleted_at": None},
            {"$set": {"date": new_date}},
        )
        # A schedule date moved, so existing /workload rows now slot into
        # a different period bucket — drop the cache so the next read
        # recomputes.
        await invalidate_workload_cache()
    return updated


@router.delete(
    "/{project_id}",
    summary="Delete a project and associated tasks",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def delete_project(project_id: str, user: SchedulerRequired):
    # Snapshot before soft-delete so the notification can name the project
    # and still resolve the partner_org_id for recipient resolution.
    project_snapshot = await db.projects.find_one(
        {"id": project_id, "deleted_at": None}, {"_id": 0},
    )
    now = datetime.now(timezone.utc).isoformat()
    result = await db.projects.update_one(
        {"id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    # Soft-delete associated tasks, documents, messages so the audit trail
    # survives. Hard deletes would break any downstream report that cites
    # a task or document that later vanished.
    await db.tasks.update_many(
        {"project_id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    await db.documents.update_many(
        {"project_id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    await db.messages.update_many(
        {"project_id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    await log_activity(
        "project_deleted", f"Project '{project_id}' deleted with associated data",
        "project", project_id, user.get("name", "System"),
    )
    if project_snapshot:
        await notify_project_deleted(project_snapshot, user)
    return {"message": "Project deleted"}


@router.post(
    "/{project_id}/advance-phase",
    summary="Advance project to next phase",
    responses={
        400: {"description": "Project is already complete"},
        403: {"description": "Only admins can force-advance past incomplete tasks"},
        404: {"description": PROJECT_NOT_FOUND},
    },
)
async def advance_phase(
    project_id: str,
    user: SchedulerRequired,
    body: Optional[PhaseAdvanceRequest] = None,
):
    force = body.force if body else False

    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None}, {"_id": 0}
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    current = project.get("phase", "planning")
    current_idx = PROJECT_PHASE_ORDER.get(current, 0)
    if current_idx >= len(PROJECT_PHASES) - 1:
        raise HTTPException(status_code=400, detail="Project is already complete")

    next_phase = PROJECT_PHASES[current_idx + 1]

    # Phase gate: check task completion in current phase
    tasks = await db.tasks.find(
        {"project_id": project_id, "phase": current, "deleted_at": None},
        {"_id": 0, "id": 1, "title": 1, "completed": 1},
    ).to_list(1000)
    incomplete_tasks = [t for t in tasks if not t.get("completed")]
    total = len(tasks)
    completed_count = total - len(incomplete_tasks)
    completion_pct = round((completed_count / total * 100) if total else 100, 1)

    if incomplete_tasks and not force:
        return {
            "warning": True,
            "incomplete_tasks": [
                {"id": t["id"], "title": t["title"]} for t in incomplete_tasks
            ],
            "completion_percentage": completion_pct,
            "completed_count": completed_count,
            "total_count": total,
            "current_phase": current,
            "next_phase": next_phase,
        }

    # Force-advance past incomplete tasks is admin-only and audited. Scheduler/
    # editor roles can only advance when every task in the current phase is
    # already completed.
    force_with_incomplete = force and bool(incomplete_tasks)
    if force_with_incomplete and user.get("role") != ROLE_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Only admins can force-advance past incomplete tasks.",
        )

    now = datetime.now(timezone.utc).isoformat()
    await db.projects.update_one(
        {"id": project_id},
        {"$set": {"phase": next_phase, "updated_at": now}},
    )
    if force_with_incomplete:
        skipped_titles = ", ".join(t["title"] for t in incomplete_tasks)
        await log_activity(
            "project_phase_force_advanced",
            (
                f"Force-advanced {current} -> {next_phase} skipping "
                f"{len(incomplete_tasks)} incomplete task(s): {skipped_titles}"
            ),
            "project", project_id, user.get("name", "System"),
            user_id=user.get("user_id"),
        )
    else:
        await log_activity(
            "project_phase_advanced",
            f"Project advanced from {current} to {next_phase}",
            "project", project_id, user.get("name", "System"),
            user_id=user.get("user_id"),
        )
    await notify_project_phase_advanced(project, current, next_phase, user)
    return {"warning": False, "phase": next_phase, "previous_phase": current}
