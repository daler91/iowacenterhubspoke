"""Centralized pagination dependency for list endpoints.

Before this module, each list router implemented `skip` / `limit` independently
and only `schedule_crud.py` clamped the upper bound. Unbounded limits are a
latency and memory hazard on read-heavy dashboards, so every list endpoint
should accept a shared ``PaginationParams`` dependency that enforces a sane
maximum and returns a consistent response envelope.

``DEFAULT_PAGE_SIZE`` is deliberately set to match ``MAX_PAGE_SIZE`` so that
**migrated endpoints behave identically to their prior defaults** for
unpaginated callers. Historically every router used a default in the range
100-200 (e.g. ``classes.py`` defaulted to 200, the others to 100), and the
frontend ``useDashboardData`` hook invokes ``getAll()`` with no params and
expects to receive every record. Setting the default below the prior per
-router maximum would silently truncate those dashboards for deployments
with 51+ records in any collection. The upper bound still stops clients
from requesting arbitrarily large pages.

Routers that want a narrower default for their own UX can build a local
dependency with a different default ``limit`` and opt into it via
``Depends(...)``; this module's dependency stays at the permissive default.

Example::

    from core.pagination import PaginationParams, pagination_params, paginated_response

    @router.get("/items")
    async def list_items(
        pagination: PaginationParams = Depends(pagination_params),
    ):
        cursor = db.items.find({"deleted_at": None}).skip(pagination.skip).limit(pagination.limit)
        items = await cursor.to_list(pagination.limit)
        total = await db.items.count_documents({"deleted_at": None})
        return paginated_response(items, total, pagination)
"""

from dataclasses import dataclass
from typing import Annotated, Any, Iterable, Mapping

from fastapi import Depends, Query

MAX_PAGE_SIZE = 200
# Intentionally equal to MAX_PAGE_SIZE — see module docstring. The important
# behavior delta from the pre-pagination era is not a smaller default but
# the *bounded* max, which was previously missing on every router except
# schedule_crud.
DEFAULT_PAGE_SIZE = MAX_PAGE_SIZE


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
    """FastAPI dependency function. Prefer the ``Paginated`` type alias below
    at call sites — it's ``Annotated[PaginationParams, Depends(...)]`` wired
    up so a handler signature reads ``pagination: Paginated`` with no
    default-argument footgun.
    """
    return PaginationParams(skip=skip, limit=limit)


# Type alias used at router call sites. Mirrors the ``CurrentUser`` pattern
# in ``core/auth.py`` so every handler is a one-liner dependency:
#
#     @router.get("/items")
#     async def list_items(pagination: Paginated):
#         ...
#
# The ``Annotated`` form is the modern FastAPI style (see
# https://fastapi.tiangolo.com/tutorial/dependencies/#share-annotated-dependencies)
# and avoids the ``default=Depends(...)`` pattern SonarCloud flags.
Paginated = Annotated[PaginationParams, Depends(pagination_params)]
