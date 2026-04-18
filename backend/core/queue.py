import logging
import os
from arq import create_pool
from arq.connections import RedisSettings
from core.constants import DEFAULT_REDIS_URL

_logger = logging.getLogger(__name__)


_pool = None


async def _close_pool_quietly(pool) -> None:
    """Best-effort close so a replaced pool doesn't leak its
    connection. arq's pool is a redis client underneath and supports
    ``aclose``; older versions expose ``close``. Swallow both errors
    and any AttributeError for forward/backward compat."""
    if pool is None:
        return
    for method_name in ("aclose", "close"):
        method = getattr(pool, method_name, None)
        if method is None:
            continue
        try:
            result = method()
            if hasattr(result, "__await__"):
                await result
            return
        except Exception:
            pass


async def get_redis_pool():
    global _pool
    if _pool is not None:
        try:
            # Verify existing pool is still healthy
            await _pool.ping()
            return _pool
        except Exception:
            # Pool is stale — close it before dropping the reference so
            # the underlying connections/file descriptors don't leak.
            await _close_pool_quietly(_pool)
            _pool = None
    redis_url = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)
    try:
        _pool = await create_pool(RedisSettings.from_dsn(redis_url))
        return _pool
    except Exception:
        _logger.warning("Failed to connect to Redis. Queue operations will fall back.")
        return None


async def safe_enqueue_job(job_name: str, *args, **kwargs) -> bool:
    """Enqueue a background job, never raising.

    Returns True on success, False if the pool couldn't be created or the
    enqueue itself raised (connection reset, Redis OOM, etc.). Callers
    that need constant-time behaviour — e.g. anti-enumeration auth
    endpoints — can use this to dispatch work without having to guard
    every call site with its own try/except.
    """
    try:
        pool = await get_redis_pool()
        if pool is None:
            _logger.warning(
                "Redis unavailable — background job %s was not queued",
                job_name,
            )
            return False
        await pool.enqueue_job(job_name, *args, **kwargs)
        return True
    except Exception as e:
        _logger.warning(
            "Failed to enqueue background job %s: %s", job_name, e,
        )
        return False
