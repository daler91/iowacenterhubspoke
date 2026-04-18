import logging
import os

from fastapi import HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from core.constants import DEFAULT_REDIS_URL

logger = logging.getLogger(__name__)

redis_url = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)

# ``swallow_errors=True`` tells SlowAPI to fail open when the storage
# backend is unreachable (Redis is down). Without this, a Redis outage
# would surface as a 500 on every rate-limited endpoint — including
# /login — bricking auth for the duration. Failing open means brief
# windows of unlimited throughput, which is the lesser evil.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=redis_url,
    default_limits=["100/minute"],
    swallow_errors=True,
)


_BULK_CREDIT_WINDOW_SECONDS = 60
_BULK_CREDIT_BUDGET = int(os.environ.get("BULK_CREDIT_BUDGET", "500"))
_BULK_CREDIT_KEY_PREFIX = "bulk_credits:"

_logger = logging.getLogger(__name__)


async def consume_bulk_credits(request: Request, cost: int) -> None:
    """Charge ``cost`` per-item credits against the caller's rolling minute.

    A standard rate limit counts a single bulk endpoint call as one credit
    no matter how many ids it carries — a 10k-id bulk-delete costs the
    same as a 1-id one. This helper charges ``len(ids)`` against a Redis
    counter per client IP with a 60s TTL so rapid fire-hose callers get
    throttled in proportion to the work they ask the DB to do.

    Best-effort: Redis failures fall through (no block) so a network blip
    doesn't break bulk endpoints for legitimate operators.
    """
    if cost <= 0:
        return
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is None:
            return
        key = f"{_BULK_CREDIT_KEY_PREFIX}{get_remote_address(request)}"
        used = await pool.incrby(key, cost)
        if used == cost:
            await pool.expire(key, _BULK_CREDIT_WINDOW_SECONDS)
        if used > _BULK_CREDIT_BUDGET:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Bulk credit budget exceeded "
                    f"({used}/{_BULK_CREDIT_BUDGET} per {_BULK_CREDIT_WINDOW_SECONDS}s)."
                ),
            )
    except HTTPException:
        raise
    except Exception as exc:
        _logger.warning("bulk credit tracking failed: %s", exc)
