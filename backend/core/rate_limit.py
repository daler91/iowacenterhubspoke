import os
from slowapi import Limiter
from slowapi.util import get_remote_address
from core.constants import DEFAULT_REDIS_URL

redis_url = os.environ.get("REDIS_URL", DEFAULT_REDIS_URL)

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=redis_url,
    default_limits=["100/minute"]
)
