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

import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from core.logger import get_logger
from migrations import MIGRATIONS

logger = get_logger(__name__)

_COLLECTION = "schema_migrations"

_LOCK_KEY = "schema_migrations:lock"
_LOCK_TTL_SECONDS = 600
_LOCK_WAIT_SECONDS = 120
_LOCK_POLL_SECONDS = 2


async def _try_acquire_redis_lock(instance_id: str):
    """Return (pool, acquired_bool) or (None, True) if Redis is unreachable.

    When Redis is down we fall back to running the migrations without
    coordination. This preserves the single-instance dev experience and
    matches how other Redis-backed features degrade elsewhere in the app.
    """
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
    except Exception as exc:
        logger.warning("migration lock: Redis unreachable (%s); running unlocked", exc)
        return None, True
    if pool is None:
        logger.warning("migration lock: Redis unreachable; running unlocked")
        return None, True
    try:
        acquired = await pool.set(
            _LOCK_KEY, instance_id, nx=True, ex=_LOCK_TTL_SECONDS,
        )
        return pool, bool(acquired)
    except Exception as exc:
        logger.warning("migration lock: acquire failed (%s); running unlocked", exc)
        return pool, True


async def _wait_for_lock_clear(pool) -> None:
    """Block up to ``_LOCK_WAIT_SECONDS`` for the winner to finish."""
    deadline = asyncio.get_event_loop().time() + _LOCK_WAIT_SECONDS
    while asyncio.get_event_loop().time() < deadline:
        try:
            holder = await pool.get(_LOCK_KEY)
        except Exception as exc:
            logger.warning("migration lock: poll failed (%s); proceeding", exc)
            return
        if holder is None:
            return
        await asyncio.sleep(_LOCK_POLL_SECONDS)
    logger.warning(
        "migration lock: still held after %ss wait; proceeding to re-verify applied set",
        _LOCK_WAIT_SECONDS,
    )


async def _release_redis_lock(pool, instance_id: str) -> None:
    if pool is None:
        return
    try:
        current = await pool.get(_LOCK_KEY)
        if current is None:
            return
        if isinstance(current, bytes):
            current = current.decode()
        if current == instance_id:
            await pool.delete(_LOCK_KEY)
    except Exception as exc:
        logger.debug("migration lock: release failed (%s)", exc)


async def run_pending(db) -> dict:
    """Apply every migration whose ID isn't already recorded as applied.

    Returns a summary ``{"applied": [...], "skipped": [...]}`` for the caller
    (the FastAPI lifespan) to log.

    Coordination: wrapped in a Redis lock so two simultaneously-booting
    replicas can't race on migration writes. The non-winner blocks for up
    to 2 minutes, then re-reads ``applied_ids`` — by then every migration
    the winner was going to run has recorded its `schema_migrations` doc
    and the non-winner will skip everything and return.
    """
    instance_id = f"{os.getpid()}:{uuid.uuid4().hex[:8]}"
    pool, acquired = await _try_acquire_redis_lock(instance_id)

    if not acquired:
        logger.info(
            "migration lock held by another instance; waiting up to %ss",
            _LOCK_WAIT_SECONDS,
        )
        await _wait_for_lock_clear(pool)
        # Re-read applied set — the winner has finished writing by now.
        return await _run_unlocked(db)

    logger.info("migration runner: won lock as %s", instance_id)
    try:
        return await _run_unlocked(db)
    finally:
        await _release_redis_lock(pool, instance_id)


async def _run_unlocked(db) -> dict:
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
