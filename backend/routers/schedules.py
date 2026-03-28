"""
Schedule router - combines all schedule sub-routers into a single router.

Split into:
  - schedule_crud.py      — CRUD, create (single + bulk), update, delete, restore, status, relocate
  - schedule_bulk.py      — Bulk operations (delete, status, reassign, location, class)
  - schedule_import.py    — CSV import/export
  - schedule_conflicts.py — Conflict checking and travel chain
  - schedule_helpers.py   — Shared constants, helpers, Outlook integration, town-to-town logic
"""

from fastapi import APIRouter

from routers.schedule_import import router as import_router
from routers.schedule_bulk import router as bulk_router
from routers.schedule_conflicts import router as conflicts_router
from routers.schedule_crud import router as crud_router

router = APIRouter(prefix="/schedules", tags=["schedules"])

# Order matters: specific paths (import/*, bulk-*, check-conflicts) before parameterized (/{id})
router.include_router(import_router)
router.include_router(bulk_router)
router.include_router(conflicts_router)
router.include_router(crud_router)
