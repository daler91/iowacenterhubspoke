import os
import logging
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
