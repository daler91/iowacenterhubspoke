# Database migrations

The backend ships with an auto-applying migration runner so every deployment
converges to the same MongoDB schema without any manual `python -m
migrations.<name>` ceremony.

## How it works

`backend/migrations/runner.py` is invoked from the FastAPI lifespan
immediately after the Mongo connection is verified. On every startup it:

1. Reads the `schema_migrations` collection for already-applied migration
   IDs.
2. Iterates the ordered `MIGRATIONS` registry in
   `backend/migrations/__init__.py`.
3. For each migration whose ID is missing from `schema_migrations`, calls
   the registered `async def run(db)` and records `{id, status: "applied",
   applied_at, affected}` on success.
4. On failure, records `{id, status: "failed", error, attempted_at}` and
   re-raises so the app refuses to start against a half-migrated database.

The current registry, in execution order:

| ID | Source | What it does |
|---|---|---|
| `001_multi_employee` | `migrate_multi_employee.py` | Convert legacy single-employee schedule docs to the multi-employee model. |
| `002_rename_class_type_to_event_format` | `rename_class_type_to_event_format.py` | Rename `class_type` → `event_format` in `projects` and `project_templates`. |
| `003_add_task_status_fields` | `add_task_status_fields.py` | Add `status` / `spotlight` / `at_risk` to legacy `tasks` docs. |
| `004_backfill_project_class_id` | `backfill_project_class_id.py` | Copy `class_id` from linked schedule into project docs that lack it. |

## Idempotency contract

Every migration in the registry MUST be idempotent — its query filter must
identify only the rows that need updating, so re-running against an
already-migrated database is a no-op. The four shipped migrations all use
filters like `{"field": {"$exists": False}}` or `{"field": None}`. If you add
a new migration, follow the same pattern or include a pre-check that exits
early when nothing needs doing.

The runner relies on this invariant: on first deploy against a production
database that already has every historical migration applied (because it
was migrated by hand before the runner existed), the runner will see an
empty `schema_migrations` collection, attempt every migration in turn, see
that there's nothing to update, and record them all as applied. **No data
is at risk** — that's the whole point of the idempotency requirement.

## Running a migration manually

You generally do not need to. If you want to run one ad-hoc against a
local database (for example to test a new migration script before
registering it), each script keeps a `__main__` block that opens its own
Mongo client from `MONGO_URL` / `DB_NAME` env vars:

```bash
cd backend
python -m migrations.add_task_status_fields
```

## Adding a new migration

1. Create `backend/migrations/<short_name>.py` with an `async def run(db)`
   entry point. Mirror the layout of one of the existing scripts.
2. Append it to `MIGRATIONS` in `backend/migrations/__init__.py`. **Use
   the next sequence number** (e.g. `005_my_change`) — IDs are stored
   verbatim and must never be renamed once shipped.
3. Add unit coverage to `backend/tests/test_migration_runner.py` if the
   migration has non-trivial logic.
4. Deploy. The runner picks it up on the next startup.

## Failure recovery

If a migration fails mid-flight:

- The `schema_migrations` collection records `{status: "failed", error,
  attempted_at}` for that ID.
- The FastAPI lifespan re-raises the exception, so the app does NOT start
  against a partially-migrated database.
- Operators must inspect the error, fix the underlying cause (often a
  missing field on a particular doc), and either:
  - Rerun the deploy (the runner will retry the failed ID), or
  - Manually delete the failed `schema_migrations` row and rerun.

Both flows are safe because every migration is idempotent.
