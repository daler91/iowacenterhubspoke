"""Partner portal router package.

Originally this was a single 478-line ``routers/partner_portal.py`` that
mixed auth, dashboard aggregation, task management, document upload, and
messaging concerns. This package splits each bounded context into its own
module while preserving the exact same ``/portal`` URL space — clients do
not need to change anything.

Each sub-router defines an ``APIRouter(prefix="/portal", tags=["portal"])``
and the package-level ``router`` here includes them all, so server.py can
continue to expose a single ``portal.router`` mount point.
"""

from fastapi import APIRouter

from . import auth, dashboard, documents, messages, tasks

router = APIRouter()
router.include_router(auth.router)
router.include_router(dashboard.router)
router.include_router(tasks.router)
router.include_router(documents.router)
router.include_router(messages.router)

__all__ = ["router"]
