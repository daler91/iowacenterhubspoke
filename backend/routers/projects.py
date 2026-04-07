import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import ProjectCreate, ProjectUpdate
from core.auth import CurrentUser
from core.constants import PROJECT_PHASES, PROJECT_PHASE_ORDER
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_NOT_FOUND = "Project not found"
NO_FIELDS_TO_UPDATE = "No fields to update"

# ── Templates ─────────────────────────────────────────────────────────

templates_router = APIRouter(prefix="/project-templates", tags=["projects"])


@templates_router.get("", summary="List project templates")
async def list_templates(user: CurrentUser):
    templates = await db.project_templates.find({}, {"_id": 0}).to_list(50)
    return {"items": templates, "total": len(templates)}


# ── Projects ──────────────────────────────────────────────────────────


@router.get("/board", summary="Portfolio kanban board")
async def get_project_board(
    user: CurrentUser,
    community: Optional[str] = None,
    class_type: Optional[str] = None,
):
    query = {"deleted_at": None, "phase": {"$ne": "complete"}}
    if community:
        query["community"] = community
    if class_type:
        query["class_type"] = class_type

    projects = await db.projects.find(query, {"_id": 0}).to_list(500)
    project_ids = [p["id"] for p in projects]

    # Fetch task counts per project
    task_stats = {}
    if project_ids:
        tasks = await db.tasks.find(
            {"project_id": {"$in": project_ids}},
            {"_id": 0, "project_id": 1, "completed": 1, "owner": 1, "due_date": 1},
        ).to_list(10000)
        now = datetime.now(timezone.utc).isoformat()
        for t in tasks:
            pid = t["project_id"]
            if pid not in task_stats:
                task_stats[pid] = {"total": 0, "completed": 0, "partner_overdue": 0}
            task_stats[pid]["total"] += 1
            if t.get("completed"):
                task_stats[pid]["completed"] += 1
            elif t.get("owner") in ("partner", "both") and t.get("due_date", "") < now:
                task_stats[pid]["partner_overdue"] += 1

    # Group by phase
    columns = {}
    for phase in PROJECT_PHASES:
        if phase == "complete":
            continue
        columns[phase] = []

    for p in projects:
        phase = p.get("phase", "planning")
        stats = task_stats.get(p["id"], {"total": 0, "completed": 0, "partner_overdue": 0})
        p["task_total"] = stats["total"]
        p["task_completed"] = stats["completed"]
        p["partner_overdue"] = stats["partner_overdue"]
        if phase in columns:
            columns[phase].append(p)

    return {"columns": columns}


@router.get("/dashboard", summary="Multi-community dashboard metrics")
async def get_dashboard(user: CurrentUser):
    all_projects = await db.projects.find({"deleted_at": None}, {"_id": 0}).to_list(2000)
    partner_orgs = await db.partner_orgs.find(
        {"deleted_at": None, "status": "active"}, {"_id": 0}
    ).to_list(500)

    completed = [p for p in all_projects if p.get("phase") == "complete"]
    upcoming = [p for p in all_projects if p.get("phase") != "complete"]
    total_attendance = sum(p.get("attendance_count") or 0 for p in completed)
    total_warm_leads = sum(p.get("warm_leads") or 0 for p in completed)

    # Count overdue tasks across upcoming projects
    upcoming_ids = [p["id"] for p in upcoming]
    overdue_count = 0
    now = datetime.now(timezone.utc).isoformat()
    if upcoming_ids:
        overdue_tasks = await db.tasks.find(
            {"project_id": {"$in": upcoming_ids}, "completed": False, "due_date": {"$lt": now}},
            {"_id": 0},
        ).to_list(5000)
        overdue_count = len(overdue_tasks)

    # Per-community breakdown
    communities = {}
    for p in all_projects:
        c = p.get("community", "Unknown")
        if c not in communities:
            communities[c] = {
                "community": c, "delivered": 0, "upcoming": 0,
                "attendance": 0, "warm_leads": 0, "phases": {},
            }
        if p.get("phase") == "complete":
            communities[c]["delivered"] += 1
            communities[c]["attendance"] += p.get("attendance_count") or 0
            communities[c]["warm_leads"] += p.get("warm_leads") or 0
        else:
            communities[c]["upcoming"] += 1
            phase = p.get("phase", "planning")
            communities[c]["phases"][phase] = communities[c]["phases"].get(phase, 0) + 1

    return {
        "classes_delivered": len(completed),
        "total_attendance": total_attendance,
        "warm_leads": total_warm_leads,
        "active_partners": len(partner_orgs),
        "upcoming_classes": len(upcoming),
        "overdue_alert_count": overdue_count,
        "communities": list(communities.values()),
        "upcoming_projects": sorted(upcoming, key=lambda x: x.get("event_date", ""))[:20],
    }


@router.get("", summary="List projects")
async def list_projects(
    user: CurrentUser,
    community: Optional[str] = None,
    phase: Optional[str] = None,
    class_type: Optional[str] = None,
    partner_org_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    query = {"deleted_at": None}
    if community:
        query["community"] = community
    if phase:
        query["phase"] = phase
    if class_type:
        query["class_type"] = class_type
    if partner_org_id:
        query["partner_org_id"] = partner_org_id
    total = await db.projects.count_documents(query)
    items = await db.projects.find(query, {"_id": 0}).sort("event_date", -1).skip(skip).limit(limit).to_list(limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.post("", summary="Create a project")
async def create_project(data: ProjectCreate, user: CurrentUser):
    project_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    doc = {
        "id": project_id,
        "title": data.title,
        "class_type": data.class_type,
        "partner_org_id": data.partner_org_id,
        "template_id": data.template_id,
        "schedule_id": data.schedule_id,
        "event_date": data.event_date,
        "phase": "planning",
        "community": data.community,
        "venue_name": data.venue_name,
        "registration_count": 0,
        "attendance_count": None,
        "warm_leads": None,
        "notes": "",
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("id", ""),
        "deleted_at": None,
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)

    # Clone tasks from template
    tasks_created = 0
    if data.template_id:
        template = await db.project_templates.find_one(
            {"id": data.template_id}, {"_id": 0}
        )
        if template and template.get("default_tasks"):
            try:
                event_dt = datetime.fromisoformat(data.event_date)
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
                    "created_at": now,
                })
            if task_docs:
                await db.tasks.insert_many(task_docs)
                tasks_created = len(task_docs)

    logger.info("Project created", extra={"entity": {"project_id": project_id}})
    await log_activity(
        "project_created",
        f"Project '{data.title}' created in {data.community}",
        "project", project_id, user.get("name", "System"),
    )
    doc["tasks_created"] = tasks_created
    return doc


@router.get("/{project_id}", summary="Get a single project with task counts")
async def get_project(project_id: str, user: CurrentUser):
    project = await db.projects.find_one(
        {"id": project_id, "deleted_at": None}, {"_id": 0}
    )
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)

    # Task counts per phase
    tasks = await db.tasks.find(
        {"project_id": project_id}, {"_id": 0, "phase": 1, "completed": 1}
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

    # Fetch partner org name
    org = await db.partner_orgs.find_one(
        {"id": project.get("partner_org_id")}, {"_id": 0, "name": 1}
    )
    project["partner_org_name"] = org["name"] if org else None

    return project


@router.put("/{project_id}", summary="Update a project")
async def update_project(project_id: str, data: ProjectUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.projects.update_one(
        {"id": project_id, "deleted_at": None}, {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    updated = await db.projects.find_one({"id": project_id}, {"_id": 0})
    return updated


@router.delete("/{project_id}", summary="Delete a project and associated tasks")
async def delete_project(project_id: str, user: CurrentUser):
    now = datetime.now(timezone.utc).isoformat()
    result = await db.projects.update_one(
        {"id": project_id, "deleted_at": None},
        {"$set": {"deleted_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    # Also soft-delete associated tasks, documents, messages
    await db.tasks.delete_many({"project_id": project_id})
    await db.documents.delete_many({"project_id": project_id})
    await db.messages.delete_many({"project_id": project_id})
    await log_activity(
        "project_deleted", f"Project '{project_id}' deleted with associated data",
        "project", project_id, user.get("name", "System"),
    )
    return {"message": "Project deleted"}


@router.post("/{project_id}/advance-phase", summary="Advance project to next phase")
async def advance_phase(project_id: str, user: CurrentUser):
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
    now = datetime.now(timezone.utc).isoformat()
    await db.projects.update_one(
        {"id": project_id},
        {"$set": {"phase": next_phase, "updated_at": now}},
    )
    await log_activity(
        "project_phase_advanced",
        f"Project advanced from {current} to {next_phase}",
        "project", project_id, user.get("name", "System"),
    )
    return {"phase": next_phase, "previous_phase": current}
