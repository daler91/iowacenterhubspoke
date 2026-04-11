"""Centralized pagination dependency for list endpoints.

Before this module, each list router implemented `skip` / `limit` independently
and only `schedule_crud.py` clamped the upper bound. Unbounded limits are a
latency and memory hazard on read-heavy dashboards, so every list endpoint
should accept a shared ``PaginationParams`` dependency that enforces a sane
maximum and returns a consistent response envelope.

Example::

    from core.pagination import PaginationParams, paginated_response

    @router.get("/items")
    async def list_items(pagination: PaginationParams = Depends()):
        cursor = db.items.find({"deleted_at": None}).skip(pagination.skip).limit(pagination.limit)
        items = await cursor.to_list(pagination.limit)
        total = await db.items.count_documents({"deleted_at": None})
        return paginated_response(items, total, pagination)
"""

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from fastapi import Query

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@dataclass
class PaginationParams:
    """FastAPI dependency: ``skip`` / ``limit`` with a server-enforced cap.

    Validation is applied via ``fastapi.Query`` at the dependency
    declaration, so out-of-range values return 422 without the handler
    running. ``limit`` is clamped to [1, ``MAX_PAGE_SIZE``]; ``skip`` is
    clamped to [0, inf).
    """

    skip: int = 0
    limit: int = DEFAULT_PAGE_SIZE


def paginated_response(
    items: Iterable[Mapping[str, Any]],
    total: int,
    pagination: "PaginationParams",
) -> dict:
    """Uniform response envelope for paginated list endpoints."""
    return {
        "items": list(items),
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


def pagination_params(
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(
        DEFAULT_PAGE_SIZE,
        ge=1,
        le=MAX_PAGE_SIZE,
        description=f"Number of items to return (max {MAX_PAGE_SIZE})",
    ),
) -> PaginationParams:
    """FastAPI dependency factory — import this, not the dataclass, from routers.

    Usage::

        from fastapi import Depends
        from core.pagination import PaginationParams, pagination_params

        @router.get("/items")
        async def list_items(
            pagination: PaginationParams = Depends(pagination_params),
        ):
            ...
    """
    return PaginationParams(skip=skip, limit=limit)
