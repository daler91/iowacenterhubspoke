import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from database import db
from models.coordination_schemas import TaskCreate, TaskUpdate, TaskReorder
from core.auth import CurrentUser
from services.activity import log_activity
from core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["project-tasks"])

TASK_NOT_FOUND = "Task not found"
PROJECT_NOT_FOUND = "Project not found"
NO_FIELDS_TO_UPDATE = "No fields to update"


async def _verify_project(project_id: str):
    project = await db.projects.find_one({"id": project_id, "deleted_at": None})
    if not project:
        raise HTTPException(status_code=404, detail=PROJECT_NOT_FOUND)
    return project


@router.get(
    "",
    summary="List tasks for a project",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def list_tasks(
    project_id: str,
    user: CurrentUser,
    phase: Optional[str] = None,
    owner: Optional[str] = None,
    completed: Optional[bool] = None,
):
    await _verify_project(project_id)
    query: dict = {"project_id": project_id}
    if phase:
        query["phase"] = phase
    if owner:
        query["owner"] = owner
    if completed is not None:
        query["completed"] = completed
    tasks = await db.tasks.find(query, {"_id": 0}).sort("sort_order", 1).to_list(1000)
    return {"items": tasks, "total": len(tasks)}


@router.post(
    "",
    summary="Create a custom task",
    responses={404: {"description": PROJECT_NOT_FOUND}},
)
async def create_task(project_id: str, data: TaskCreate, user: CurrentUser):
    await _verify_project(project_id)
    last_task = await db.tasks.find(
        {"project_id": project_id}, {"sort_order": 1}
    ).sort("sort_order", -1).limit(1).to_list(1)
    next_order = (last_task[0]["sort_order"] + 1) if last_task else 0

    task_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": task_id,
        "project_id": project_id,
        "title": data.title,
        "phase": data.phase,
        "owner": data.owner,
        "assigned_to": data.assigned_to,
        "due_date": data.due_date,
        "completed": False,
        "completed_at": None,
        "completed_by": None,
        "sort_order": next_order,
        "details": data.details or "",
        "created_at": now,
    }
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(
        "task_created", f"Task '{data.title}' created",
        "task", task_id, user.get("name", "System"),
    )
    return doc


@router.put(
    "/{task_id}",
    summary="Update a task",
    responses={
        400: {"description": NO_FIELDS_TO_UPDATE},
        404: {"description": TASK_NOT_FOUND},
    },
)
async def update_task(project_id: str, task_id: str, data: TaskUpdate, user: CurrentUser):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail=NO_FIELDS_TO_UPDATE)
    result = await db.tasks.update_one(
        {"id": task_id, "project_id": project_id},
        {"$set": update_data},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    updated = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return updated


@router.patch(
    "/{task_id}/complete",
    summary="Toggle task completion",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def toggle_task_completion(project_id: str, task_id: str, user: CurrentUser):
    task = await db.tasks.find_one({"id": task_id, "project_id": project_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)

    now = datetime.now(timezone.utc).isoformat()
    new_completed = not task.get("completed", False)
    update = {
        "completed": new_completed,
        "completed_at": now if new_completed else None,
        "completed_by": user.get("name", "System") if new_completed else None,
    }
    await db.tasks.update_one({"id": task_id}, {"$set": update})
    task.update(update)
    return task


@router.patch("/reorder", summary="Bulk reorder tasks",
              responses={404: {"description": PROJECT_NOT_FOUND}})
async def reorder_tasks(project_id: str, data: TaskReorder, user: CurrentUser):
    await _verify_project(project_id)
    for idx, task_id in enumerate(data.task_ids):
        await db.tasks.update_one(
            {"id": task_id, "project_id": project_id},
            {"$set": {"sort_order": idx}},
        )
    return {"message": "Tasks reordered", "count": len(data.task_ids)}


@router.delete(
    "/{task_id}",
    summary="Delete a task",
    responses={404: {"description": TASK_NOT_FOUND}},
)
async def delete_task(project_id: str, task_id: str, user: CurrentUser):
    result = await db.tasks.delete_one({"id": task_id, "project_id": project_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=TASK_NOT_FOUND)
    await log_activity(
        "task_deleted", f"Task '{task_id}' deleted",
        "task", task_id, user.get("name", "System"),
    )
    return {"message": "Task deleted"}
