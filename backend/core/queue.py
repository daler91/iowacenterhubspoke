import os
from arq import create_pool
from arq.connections import RedisSettings

async def get_redis_pool():
    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    try:
        pool = await create_pool(RedisSettings.from_dsn(redis_url))
        return pool
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to connect to Redis. Queue operations will fall back.")
        return None
