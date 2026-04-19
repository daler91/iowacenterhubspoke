"""Redis-backed cache for the /workload endpoint.

The workload aggregation fans out over ~1000 schedules and ~100 employees
and runs a full in-process grouping pass on every request. The Insights
dashboard hits it on mount, and a fresh tab open after navigation pays
that cost again even when nothing has changed. A 60-second TTL with
explicit invalidation on every schedule / class / employee mutation
keeps the payload responsive without serving post-mutation staleness.

All operations are graceful no-ops when Redis is unreachable — the caller
falls back to computing the value inline, so the app keeps working; we
just lose the speedup.
"""

import json
from typing import Any, Awaitable, Callable, Optional

from core.logger import get_logger

logger = get_logger(__name__)

_CACHE_KEY = "cache:workload:v1"
_DEFAULT_TTL_SECONDS = 60


# Public alias so worker-side code can bust the key without holding a
# reference to the FastAPI app — the worker runs in its own process.
CACHE_KEY = _CACHE_KEY

# Getter rather than a raw client so a reconnect in the health-check path
# propagates here without us having to know about it.
_client_getter: Optional[Callable[[], Optional[Any]]] = None


def set_client_getter(getter: Optional[Callable[[], Optional[Any]]]) -> None:
    """Register (or clear) the accessor used to reach the shared Redis client."""
    global _client_getter
    _client_getter = getter


def _current_client() -> Optional[Any]:
    if _client_getter is None:
        return None
    try:
        return _client_getter()
    except Exception:
        return None


async def get_or_compute(
    loader: Callable[[], Awaitable[Any]],
    *,
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
) -> Any:
    """Return the cached payload or compute, store, and return it."""
    client = _current_client()
    if client is None:
        return await loader()
    try:
        raw = await client.get(_CACHE_KEY)
    except Exception as e:
        logger.warning("workload cache get failed: %s", e)
        return await loader()
    if raw is not None:
        try:
            return json.loads(raw)
        except Exception:
            # Corrupt cache entry — fall through and rewrite it below.
            pass
    value = await loader()
    try:
        await client.set(_CACHE_KEY, json.dumps(value), ex=ttl_seconds)
    except Exception as e:
        logger.warning("workload cache set failed: %s", e)
    return value


async def invalidate() -> None:
    """Drop the cached workload payload. Called from mutation endpoints."""
    client = _current_client()
    if client is None:
        return
    try:
        await client.delete(_CACHE_KEY)
    except Exception as e:
        logger.warning("workload cache invalidate failed: %s", e)
