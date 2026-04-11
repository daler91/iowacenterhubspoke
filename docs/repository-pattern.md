# Repository pattern (`SoftDeleteRepository`)

`backend/core/repository.py` provides a thin data-access layer for any
collection that uses the project's soft-delete convention
(`{"deleted_at": null}`). It exists to retire the 170+ duplicated raw
Motor queries that were repeating `{"deleted_at": None}` filters across
every router by hand — a pattern that was mechanical, error-prone, and
made it trivial to accidentally surface deleted documents in a new
endpoint.

This document is the migration guide for converting the remaining
routers to the repository.

## What the repository gives you

```python
from core.repository import SoftDeleteRepository

locations_repo = SoftDeleteRepository(db, "locations")
```

The instance exposes:

| Method | Purpose |
|---|---|
| `find_active(query, projection=, sort=, skip=, limit=)` | List active docs matching `query`. |
| `find_one_active(query, projection=)` | Single active doc. |
| `get_by_id(doc_id, projection=)` | Convenience: `find_one_active({"id": id})`. |
| `count_active(query)` | `count_documents` with the soft-delete filter. |
| `paginate(query, pagination, projection=, sort=)` | Returns `(items, total)` using `PaginationParams`. |
| `paginated_response(query, pagination, projection=, sort=)` | Returns the full `{items, total, skip, limit}` envelope from `core.pagination`. |
| `soft_delete(doc_id, deleted_by=)` | Sets `deleted_at` (and optionally `deleted_by`) on an active doc. |
| `restore(doc_id)` | Unsets `deleted_at` on a deleted doc. |
| `update_active(doc_id, fields)` | `$set` update against an active doc. |

Every method that takes a `query` argument **automatically** injects
`"deleted_at": None`. Callers cannot forget the filter; that's the whole
point.

The repository wraps a Motor collection but does not try to be an ORM.
For specialized queries (aggregations, transactions, projection-heavy
pipelines, `update_many` calls) routers should still drop down to
`repo.collection` directly.

## Migration recipe

The reference migrations are `backend/routers/locations.py` and
`backend/routers/classes.py` — read those for a complete before/after.
The general pattern:

### 1. Construct the repo at module scope

```python
from core.repository import SoftDeleteRepository

locations_repo = SoftDeleteRepository(db, "locations")
```

### 2. Replace list endpoints with `paginated_response`

Before:

```python
@router.get("")
async def get_locations(user: CurrentUser, skip: int = 0, limit: int = 100):
    query = {"deleted_at": None}
    total = await db.locations.count_documents(query)
    locations = (
        await db.locations.find(query, {"_id": 0})
        .skip(skip)
        .limit(limit)
        .to_list(limit)
    )
    return {"items": locations, "total": total, "skip": skip, "limit": limit}
```

After:

```python
@router.get("")
async def get_locations(
    user: CurrentUser,
    pagination: PaginationParams = Depends(pagination_params),
):
    return await locations_repo.paginated_response({}, pagination)
```

### 3. Replace single-doc fetches with `get_by_id` / `find_one_active`

Before:

```python
location = await db.locations.find_one(
    {"id": location_id, "deleted_at": None}, {"_id": 0},
)
if not location:
    raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
```

After:

```python
location = await locations_repo.get_by_id(location_id)
if not location:
    raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
```

### 4. Replace soft-delete handlers

Before:

```python
result = await db.locations.update_one(
    {"id": location_id, "deleted_at": None},
    {"$set": {"deleted_at": datetime.now(timezone.utc).isoformat()}},
)
if result.matched_count == 0:
    raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
```

After:

```python
if not await locations_repo.soft_delete(location_id, deleted_by=user.get("name")):
    raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
```

### 5. Restore handlers

Note: `restore` returns `False` for docs that aren't currently in a
deleted state, which is **not** the same as 404. The locations
implementation handles this by checking existence on the false branch:

```python
async def restore_location(location_id: str, user: AdminRequired):
    if not await locations_repo.restore(location_id):
        existing = await db.locations.find_one({"id": location_id}, {"_id": 1})
        if not existing:
            raise HTTPException(status_code=404, detail=LOCATION_NOT_FOUND)
    # 200 — either restored or already active
```

## What's NOT covered

The repository deliberately does not try to handle:

- **Multi-collection writes** (e.g. soft-deleting a class also writes
  archive metadata to schedules). Keep those in the router as raw Motor
  calls — the repository would only obscure the intent.
- **Aggregation pipelines** (e.g. workload stats). Drop to
  `repo.collection.aggregate(...)` and write the pipeline by hand.
- **Indexes**. Index management lives in `server.py::_ensure_indexes`.

## Status of the migration

| Router | Status |
|---|---|
| `locations.py` | Migrated (reference implementation). |
| `classes.py` | Migrated (reference implementation). |
| `employees.py` | Pending. |
| `partner_orgs.py` | Pending. |
| `projects.py` | Pending. |
| `project_tasks.py` | Pending. |
| `project_messages.py` | Pending. |
| `project_docs.py` | Pending. |
| `webhooks.py` | Pending. |
| `system.py` | Pending. |
| `users.py` | Pending. |
| `schedule_*.py` | Pending. |
| `portal/*.py` | Pending. |
| `event_outcomes.py` | Pending. |
| `promotion_checklist.py` | Pending. |
| `exports.py` | Pending. |
| `analytics.py` | Pending. |
| `reports.py` | Pending. |

Migrating each remaining router is a self-contained PR that closes a few
of the 170 raw `deleted_at: None` call sites. They do not have to be
done in any particular order.
