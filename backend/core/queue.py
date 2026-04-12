import os
import logging
from arq import create_pool
from arq.connections import RedisSettings

logger = logging.getLogger(__name__)
_pool = None

async def get_redis_pool():
    global _pool
    if _pool is not None:
        return _pool
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    try:
        _pool = await create_pool(RedisSettings.from_dsn(redis_url))
        return _pool
    except Exception:
        logger.warning("Failed to connect to Redis. Queue operations will fall back.")
        return None
