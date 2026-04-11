"""Shared data-access helpers for soft-delete collections.

Motivation: a grep for ``"deleted_at": None`` across ``backend/routers``
returns 170+ call sites. Every list endpoint, every detail fetch, every
delete, and every restore reimplements the same soft-delete convention
independently. That makes it trivial for a new router to silently serve
deleted docs (forgetting the filter), and it couples the router layer
directly to the Mongo query DSL.

This module introduces a thin ``SoftDeleteRepository`` base class that
bundles the repeated patterns behind a typed API. The existing router
implementations are migrated incrementally — ``locations`` and ``classes``
convert as the reference in this PR; the remaining 22 files are a
follow-up tracked separately — so the payoff is gradual but the duplication
monotonically decreases as call sites migrate.

Contract:

- Every repository method automatically injects ``"deleted_at": None``
  into query filters so callers literally cannot forget.
- ``soft_delete`` sets ``deleted_at`` to the current UTC timestamp and
  optionally records ``deleted_by``.
- ``restore`` unsets ``deleted_at``; it is a no-op for docs that are not
  currently soft-deleted.
- ``paginate`` returns a ``(items, total)`` tuple using the shared
  ``PaginationParams`` dependency.

Migration example (before → after)::

    # Before
    @router.get("")
    async def list_locations(user: CurrentUser, skip: int = 0, limit: int = 100):
        query = {"deleted_at": None}
        total = await db.locations.count_documents(query)
        locations = await db.locations.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
        return {"items": locations, "total": total, ...}

    # After
    locations_repo = SoftDeleteRepository(db, "locations")

    @router.get("")
    async def list_locations(
        user: CurrentUser,
        pagination: PaginationParams = Depends(pagination_params),
    ):
        items, total = await locations_repo.paginate({}, pagination)
        return paginated_response(items, total, pagination)
"""

from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Sequence, Tuple

from core.pagination import PaginationParams, paginated_response


class SoftDeleteRepository:
    """Lightweight data-access layer for collections that use soft deletes.

    This is deliberately a thin wrapper — it does not try to be an ORM.
    Routers can still drop to the raw collection for specialized queries
    (aggregations, transactions, projection-heavy reads); the repository
    is where the *common* patterns live.
    """

    def __init__(self, db, collection_name: str, id_field: str = "id"):
        self._db = db
        self._collection_name = collection_name
        self._id_field = id_field

    @property
    def collection(self):
        """Expose the underlying Motor collection for specialized calls."""
        return self._db[self._collection_name]

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _with_active_filter(query: Optional[Mapping[str, Any]]) -> dict:
        merged = dict(query or {})
        merged.setdefault("deleted_at", None)
        return merged

    async def find_one_active(
        self,
        query: Mapping[str, Any],
        projection: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        """Return a single non-deleted document matching ``query``."""
        merged = self._with_active_filter(query)
        if projection is None:
            projection = {"_id": 0}
        return await self.collection.find_one(merged, projection)

    async def get_by_id(
        self,
        doc_id: str,
        projection: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        """Convenience wrapper around ``find_one_active`` for id lookups."""
        return await self.find_one_active({self._id_field: doc_id}, projection)

    async def find_active(
        self,
        query: Optional[Mapping[str, Any]] = None,
        projection: Optional[Mapping[str, Any]] = None,
        sort: Optional[Sequence[Tuple[str, int]]] = None,
        skip: int = 0,
        limit: int = 0,
    ) -> list[dict]:
        """Return a list of non-deleted documents matching ``query``."""
        merged = self._with_active_filter(query)
        if projection is None:
            projection = {"_id": 0}
        cursor = self.collection.find(merged, projection)
        if sort:
            cursor = cursor.sort(list(sort))
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        return await cursor.to_list(limit or None)

    async def count_active(
        self, query: Optional[Mapping[str, Any]] = None,
    ) -> int:
        return await self.collection.count_documents(
            self._with_active_filter(query)
        )

    async def paginate(
        self,
        query: Optional[Mapping[str, Any]],
        pagination: PaginationParams,
        projection: Optional[Mapping[str, Any]] = None,
        sort: Optional[Sequence[Tuple[str, int]]] = None,
    ) -> Tuple[list[dict], int]:
        """Return ``(items, total)`` scoped to the active (non-deleted) set."""
        total = await self.count_active(query)
        items = await self.find_active(
            query,
            projection=projection,
            sort=sort,
            skip=pagination.skip,
            limit=pagination.limit,
        )
        return items, total

    async def paginated_response(
        self,
        query: Optional[Mapping[str, Any]],
        pagination: PaginationParams,
        projection: Optional[Mapping[str, Any]] = None,
        sort: Optional[Sequence[Tuple[str, int]]] = None,
    ) -> dict:
        """Fetch ``paginate`` results and wrap them in the shared envelope."""
        items, total = await self.paginate(
            query, pagination, projection=projection, sort=sort,
        )
        return paginated_response(items, total, pagination)

    # ------------------------------------------------------------------
    # Mutation helpers
    # ------------------------------------------------------------------

    async def soft_delete(
        self,
        doc_id: str,
        deleted_by: Optional[str] = None,
    ) -> bool:
        """Mark a document deleted. Returns True if a row was modified."""
        update: dict = {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
        }
        if deleted_by is not None:
            update["deleted_by"] = deleted_by
        result = await self.collection.update_one(
            {self._id_field: doc_id, "deleted_at": None},
            {"$set": update},
        )
        return result.modified_count > 0

    async def restore(self, doc_id: str) -> bool:
        """Unset ``deleted_at`` / ``deleted_by`` on a previously-deleted doc."""
        result = await self.collection.update_one(
            {self._id_field: doc_id, "deleted_at": {"$ne": None}},
            {"$set": {"deleted_at": None}, "$unset": {"deleted_by": ""}},
        )
        return result.modified_count > 0

    async def update_active(
        self,
        doc_id: str,
        fields: Mapping[str, Any],
    ) -> bool:
        """Apply ``$set`` updates to a non-deleted document."""
        if not fields:
            return False
        result = await self.collection.update_one(
            {self._id_field: doc_id, "deleted_at": None},
            {"$set": dict(fields)},
        )
        return result.modified_count > 0
