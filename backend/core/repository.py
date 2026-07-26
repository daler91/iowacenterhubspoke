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

    @property
    def collection_name(self) -> str:
        """Name of the backing collection.

        Public so test helpers can rebuild a repository against a fake db
        without reaching into private state — see ``tests/conftest.py``.
        """
        return self._collection_name

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
        session=None,
    ) -> Optional[dict]:
        """Return a single non-deleted document matching ``query``."""
        merged = self._with_active_filter(query)
        if projection is None:
            projection = {"_id": 0}
        return await self.collection.find_one(merged, projection, session=session)

    async def get_by_id(
        self,
        doc_id: str,
        projection: Optional[Mapping[str, Any]] = None,
        session=None,
    ) -> Optional[dict]:
        """Convenience wrapper around ``find_one_active`` for id lookups."""
        return await self.find_one_active(
            {self._id_field: doc_id}, projection, session=session,
        )

    async def distinct_active(
        self,
        field: str,
        query: Optional[Mapping[str, Any]] = None,
        session=None,
    ) -> list:
        """Distinct values of ``field`` across the active set."""
        return await self.collection.distinct(
            field, self._with_active_filter(query), session=session,
        )

    async def find_active(
        self,
        query: Optional[Mapping[str, Any]] = None,
        projection: Optional[Mapping[str, Any]] = None,
        sort: Optional[Sequence[Tuple[str, int]]] = None,
        skip: int = 0,
        limit: int = 0,
        session=None,
    ) -> list[dict]:
        """Return a list of non-deleted documents matching ``query``."""
        merged = self._with_active_filter(query)
        if projection is None:
            projection = {"_id": 0}
        cursor = self.collection.find(merged, projection, session=session)
        if sort:
            cursor = cursor.sort(list(sort))
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        return await cursor.to_list(limit or None)

    async def count_active(
        self, query: Optional[Mapping[str, Any]] = None, session=None,
    ) -> int:
        return await self.collection.count_documents(
            self._with_active_filter(query), session=session,
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
        session=None,
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
            session=session,
        )
        return result.modified_count > 0

    async def soft_delete_many(
        self,
        query: Mapping[str, Any],
        deleted_by: Optional[str] = None,
        session=None,
    ) -> int:
        """Soft-delete every active document matching ``query``.

        Returns the modified count. Bulk soft-deletes are the one place the
        per-document helpers do not cover — a series delete has to stamp many
        rows in one round trip, and doing it row by row would leave a partly
        deleted series behind if the request died halfway.
        """
        update: dict = {"deleted_at": datetime.now(timezone.utc).isoformat()}
        if deleted_by is not None:
            update["deleted_by"] = deleted_by
        result = await self.collection.update_many(
            self._with_active_filter(query), {"$set": update}, session=session,
        )
        return result.modified_count

    async def restore(self, doc_id: str) -> bool:
        """Unset ``deleted_at`` / ``deleted_by`` on a previously-deleted doc.

        Returns False both when the id does not exist *and* when the document
        exists but is already active. Callers that need to tell those apart —
        an idempotent restore endpoint should 200 on the second call, not 404
        — must probe for existence themselves; see ``restore_schedule``.
        """
        result = await self.collection.update_one(
            {self._id_field: doc_id, "deleted_at": {"$ne": None}},
            {"$set": {"deleted_at": None}, "$unset": {"deleted_by": ""}},
        )
        return result.modified_count > 0

    async def exists(self, doc_id: str, session=None) -> bool:
        """True if the id exists at all, deleted or not.

        Deliberately ignores ``deleted_at``: this answers "is this a real id?",
        which is what separates a 404 from an already-in-that-state no-op.
        """
        found = await self.collection.find_one(
            {self._id_field: doc_id}, {"_id": 1}, session=session,
        )
        return found is not None

    async def update_active(
        self,
        doc_id: str,
        fields: Mapping[str, Any],
        session=None,
    ) -> bool:
        """Apply ``$set`` updates to a non-deleted document."""
        if not fields:
            return False
        result = await self.collection.update_one(
            {self._id_field: doc_id, "deleted_at": None},
            {"$set": dict(fields)},
            session=session,
        )
        return result.modified_count > 0

    async def update_one_active(
        self,
        query: Mapping[str, Any],
        fields: Mapping[str, Any],
        session=None,
    ) -> tuple[int, int]:
        """Update one active document matching ``query``.

        Returns ``(matched_count, modified_count)`` so callers can
        distinguish no-op writes from not-found races.
        """
        if not fields:
            return 0, 0
        result = await self.collection.update_one(
            self._with_active_filter(query),
            {"$set": dict(fields)},
            session=session,
        )
        return result.matched_count, result.modified_count

    # ------------------------------------------------------------------
    # Raw-update helpers
    #
    # The methods above take a plain field mapping and wrap it in ``$set``,
    # which covers most call sites. These take a *whole* update document
    # instead, because some writes need operators the field form cannot
    # express — ``$inc`` on an optimistic-concurrency version counter being
    # the case that forced them. The soft-delete filter is still injected
    # into the query, which is the guarantee that matters.
    # ------------------------------------------------------------------

    async def update_many_active(
        self,
        query: Mapping[str, Any],
        update: Mapping[str, Any],
        session=None,
    ) -> tuple[int, int]:
        """Apply a raw update document to every active match."""
        result = await self.collection.update_many(
            self._with_active_filter(query), dict(update), session=session,
        )
        return result.matched_count, result.modified_count

    async def find_one_and_update_active(
        self,
        query: Mapping[str, Any],
        update: Mapping[str, Any],
        projection: Optional[Mapping[str, Any]] = None,
        return_document=None,
        session=None,
    ) -> Optional[dict]:
        """Atomic find-and-update over the active set.

        Exists for compare-and-swap call sites: the query doubles as the CAS
        predicate, so a caller pinning ``version``/``date`` gets "no document
        returned" when another writer got there first.
        """
        if projection is None:
            projection = {"_id": 0}
        kwargs: dict = {"projection": projection, "session": session}
        if return_document is not None:
            kwargs["return_document"] = return_document
        return await self.collection.find_one_and_update(
            self._with_active_filter(query), dict(update), **kwargs,
        )
