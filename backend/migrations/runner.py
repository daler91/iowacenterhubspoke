"""Apply pending migrations from the registry.

This replaces the prior ad-hoc practice of running migration scripts manually
via ``python -m migrations.<name>``. The runner is invoked from the FastAPI
lifespan so every deployment converges to the same schema without operator
intervention.

Contract:
- Each migration's ID lives in ``migrations.MIGRATIONS`` and is stored in the
  ``schema_migrations`` collection once applied.
- Migrations must be **idempotent** — the registry supports replaying them
  because every migration currently in the repo filters on markers like
  "field does not yet exist". That is a load-bearing invariant; new
  migrations must follow the same pattern or add their own pre-check.
- On first-run against a production DB the runner sees an empty
  ``schema_migrations`` collection and will attempt each migration in order.
  Since they are idempotent, running them against a previously-migrated DB
  is safe and records them as ``{status: "seeded"}``.
- Failures are logged and re-raised; the FastAPI lifespan will fail fast
  rather than bring up an app against a half-migrated database.
"""

from datetime import datetime, timezone
from typing import Optional

from core.logger import get_logger
from migrations import MIGRATIONS

logger = get_logger(__name__)

_COLLECTION = "schema_migrations"


async def run_pending(db) -> dict:
    """Apply every migration whose ID isn't already recorded as applied.

    Returns a summary ``{"applied": [...], "skipped": [...]}`` for the caller
    (the FastAPI lifespan) to log.
    """
    applied_ids = {
        doc["id"]
        async for doc in db[_COLLECTION].find(
            {"status": {"$in": ["applied", "seeded"]}}, {"_id": 0, "id": 1}
        )
    }

    applied: list[str] = []
    skipped: list[str] = []

    for migration_id, migration_fn in MIGRATIONS:
        if migration_id in applied_ids:
            skipped.append(migration_id)
            continue

        started_at = datetime.now(timezone.utc).isoformat()
        try:
            affected: Optional[int] = await migration_fn(db)
        except Exception as e:
            await db[_COLLECTION].update_one(
                {"id": migration_id},
                {
                    "$set": {
                        "id": migration_id,
                        "status": "failed",
                        "error": str(e),
                        "attempted_at": started_at,
                    }
                },
                upsert=True,
            )
            logger.error(
                "Migration %s failed", migration_id, exc_info=e,
            )
            raise

        await db[_COLLECTION].update_one(
            {"id": migration_id},
            {
                "$set": {
                    "id": migration_id,
                    "status": "applied",
                    "applied_at": datetime.now(timezone.utc).isoformat(),
                    "affected": affected if affected is not None else 0,
                }
            },
            upsert=True,
        )
        applied.append(migration_id)
        logger.info(
            "Applied migration %s (affected=%s)", migration_id, affected,
        )

    if applied:
        logger.info("Migration runner: applied %d, skipped %d", len(applied), len(skipped))
    return {"applied": applied, "skipped": skipped}
