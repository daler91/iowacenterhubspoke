import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uuid

# Sentry error tracking (opt-in via SENTRY_DSN env var)
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk
    from core.sentry_scrub import sentry_before_send
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.2,
        environment=os.getenv("ENVIRONMENT", "development"),
        send_default_pii=False,
        before_send=sentry_before_send,
    )

from core.logger import setup_logging, get_logger, request_id_var  # noqa: E402

# Set up JSON structured logging
setup_logging()
logger = get_logger(__name__)

from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402
from slowapi import _rate_limit_exceeded_handler  # noqa: E402
from slowapi.errors import RateLimitExceeded  # noqa: E402
from core.rate_limit import limiter  # noqa: E402

from database import client, db, ROOT_DIR  # noqa: E402
from routers import (  # noqa: E402
    auth, locations, employees, classes, schedules, reports,
    system, analytics, users, google_oauth, outlook_oauth,
    partner_orgs, projects, project_tasks, project_docs,
    project_members, project_messages, portal,
    exports, event_outcomes, promotion_checklist, webhooks,
    notification_preferences,
)
from core.constants import DEFAULT_REDIS_URL  # noqa: E402
from app_factory import build_lifespan  # noqa: E402


async def _safe_aclose(redis_client) -> None:
    """Best-effort close of a Redis client. Never raises."""
    if redis_client is None:
        return
    try:
        await redis_client.aclose()
    except Exception:  # pragma: no cover - best-effort cleanup
        pass


async def _ensure_redis_client(app: FastAPI):
    """Lazily (re)create ``app.state.redis`` if it is missing.

    Called at startup and from the health check. If Redis was unreachable
    when the app booted, ``app.state.redis`` is ``None``; this function
    attempts to build a fresh client on the next probe so a transient
    outage at deploy time heals itself without a container restart.

    Leak note: ``redis.asyncio.from_url`` allocates a connection pool
    synchronously — if the subsequent ``ping()`` fails we MUST close that
    freshly-created client or every failing probe accumulates a leaked
    pool (file descriptors + memory) until the process degrades. This is
    the Codex P2 fix: track ``client_`` outside the try so the except
    branch can explicitly ``aclose()`` it.
    """
    if getattr(app.state, "redis", None) is not None:
        return app.state.redis

    # Import lazily to keep the redis.asyncio surface off the hot import path.
    import redis.asyncio as _async_redis
    redis_url = os.getenv("REDIS_URL", DEFAULT_REDIS_URL)

    client_ = None
    try:
        client_ = _async_redis.from_url(
            redis_url,
            socket_connect_timeout=2,
            max_connections=20,
        )
        await client_.ping()
    except Exception as e:
        logger.warning("Redis unavailable; health check will report degraded: %s", e)
        # Close the just-created client whose pool would otherwise leak.
        await _safe_aclose(client_)
        # Drop any stale cached client as well (should normally be None
        # by the time we reach this branch).
        await _safe_aclose(getattr(app.state, "redis", None))
        app.state.redis = None
        return None

    app.state.redis = client_
    logger.info("Connected to Redis")
    return client_


async def _probe_redis(app: FastAPI) -> bool:
    """Ping the cached Redis client, reconnecting on failure.

    Returns ``True`` if Redis responded to a ping; ``False`` otherwise.
    On a ping failure we discard the cached client and attempt one
    reconnect so a Redis restart after app boot doesn't leave the health
    check permanently degraded until the service is itself restarted.
    """
    client_ = getattr(app.state, "redis", None)
    if client_ is not None:
        try:
            await client_.ping()
            return True
        except Exception:
            # Cached client is stale — drop it and fall through to the
            # reconnect path below.
            await _safe_aclose(client_)
            app.state.redis = None

    fresh = await _ensure_redis_client(app)
    if fresh is None:
        return False
    try:
        await fresh.ping()
        return True
    except Exception:
        return False


async def _on_shutdown(app: FastAPI):
    from services.calendar_sync import background_tasks as _background_tasks
    if _background_tasks:
        logger.info("Waiting for %d pending calendar tasks to complete...", len(_background_tasks))
        import asyncio
        _, pending = await asyncio.wait(_background_tasks, timeout=10)
        if pending:
            logger.warning("Cancelling %d calendar tasks that didn't finish in time", len(pending))
            for task in pending:
                task.cancel()
    from services.workload_cache import set_client_getter as _set_workload_getter
    _set_workload_getter(None)
    await _safe_aclose(getattr(app.state, "redis", None))
    client.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.workload_cache import set_client_getter as _set_workload_getter
    _set_workload_getter(lambda: getattr(app.state, "redis", None))
    async with build_lifespan(
        app=app,
        client=client,
        db=db,
        logger=logger,
        ensure_redis_client=_ensure_redis_client,
        on_shutdown=_on_shutdown,
    ):
        yield


app = FastAPI(
    title="HubSpoke API",
    description=(
        "Scheduling platform for the HubSpoke hub-and-spoke model. "
        "Manages employee class assignments across satellite locations with "
        "drive time calculations, conflict detection, and analytics."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_tags=[
        {"name": "auth", "description": "Authentication, registration, and invitation management"},
        {"name": "schedules", "description": "Schedule CRUD, bulk operations, import/export, and conflict checking"},
        {"name": "locations", "description": "Location management and drive time calculations"},
        {"name": "employees", "description": "Employee management and statistics"},
        {"name": "classes", "description": "Class type management and statistics"},
        {"name": "users", "description": "User administration — approval, roles, invitations (admin only)"},
        {"name": "reports", "description": "Dashboard statistics, workload analysis, and weekly summaries"},
        {"name": "analytics", "description": "Trend analysis, forecasting, and drive optimization"},
        {"name": "system", "description": "System configuration, activity logs, and notifications"},
        {"name": "projects", "description": "Coordination projects — class engagements with partner organizations"},
        {"name": "project-tasks", "description": "Task management within coordination projects"},
        {"name": "partner-orgs", "description": "Partner organization and contact management"},
        {"name": "project-docs", "description": "Document sharing and management for projects"},
        {"name": "project-messages", "description": "Messaging within coordination projects"},
        {"name": "portal", "description": "Partner-facing portal with magic link authentication"},
    ],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = getattr(exc, "detail", str(exc))
    status_code = getattr(exc, "status_code", 500)
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "code": str(status_code), "errors": None}
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Validation Error", "code": "422", "errors": exc.errors()}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "code": "500", "errors": None}
    )

from slowapi.middleware import SlowAPIMiddleware  # noqa: E402
app.add_middleware(SlowAPIMiddleware)


# SlowAPI 0.1.x expects ``request.state.view_rate_limit`` to exist on every
# response so it can inject X-RateLimit-* headers. Endpoints that aren't
# rate-limited never set this, so starlette's State raises AttributeError
# when SlowAPIMiddleware reads it on the way out. Seed a ``None`` default
# so the attribute is always readable.
@app.middleware("http")
async def _slowapi_state_init(request: Request, call_next):
    if not hasattr(request.state, "view_rate_limit"):
        request.state.view_rate_limit = None
    return await call_next(request)

from core.auth import generate_csrf_token, validate_csrf_token  # noqa: E402

CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {
    "/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/auth/refresh", "/api/health",
    "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/logout", "/api/v1/auth/refresh", "/api/v1/health",
}


@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    """Double-submit cookie CSRF protection.

    On every response, set a readable csrf_token cookie.
    On mutating requests, require X-CSRF-Token header matching the cookie.
    """
    if request.method not in CSRF_SAFE_METHODS and request.url.path.startswith("/api"):
        if request.url.path not in CSRF_EXEMPT_PATHS:
            cookie_token = request.cookies.get("csrf_token")
            header_token = request.headers.get("x-csrf-token")
            if not cookie_token or not header_token or cookie_token != header_token:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token missing or invalid", "code": "403", "errors": None}
                )
            if not validate_csrf_token(cookie_token):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF token signature invalid", "code": "403", "errors": None}
                )

    response = await call_next(request)

    # Rotate CSRF token on every response for stronger protection.
    # The /csrf-token endpoint pins its return value into
    # ``request.state.csrf_token_override`` so that the JSON body and
    # the Set-Cookie header carry the *same* token — otherwise the
    # SPA receives a token that's stale the moment this middleware
    # overwrites the cookie, which 403s the next mutating request.
    csrf_token = (
        getattr(request.state, "csrf_token_override", None)
        or generate_csrf_token()
    )
    # Double-submit CSRF: the cookie MUST be readable by JS so the SPA can
    # echo its value in the X-CSRF-Token header on mutating requests. The
    # token itself is a random nonce + HMAC signature (see core/auth.py),
    # so an attacker who steals the cookie via XSS also needs CSRF_SECRET
    # to forge matching pairs, and XSS is a worse compromise than CSRF
    # anyway. SameSite=Lax is the primary defence.
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,
        secure=True,
        samesite="lax",
        max_age=86400 * 7,
    )

    return response

import hashlib as _hashlib  # noqa: E402

# Cache-Control + ETag for GET API responses
# Short-lived cache for dynamic data; browsers revalidate via If-None-Match
_CACHE_MAX_AGE = {
    "/api/v1/locations": 300,          # 5 min — locations rarely change
    "/api/v1/employees": 300,          # 5 min
    "/api/v1/classes": 300,            # 5 min
    "/api/v1/dashboard/stats": 60,     # 1 min
    "/api/v1/health": 30,             # 30 sec
    # /api/v1/workload deliberately NOT listed: it's cached server-side
    # for 60s via services.workload_cache with explicit invalidation on
    # every mutation (schedule_crud/_bulk/_import, classes, employees).
    # Adding a positive max-age here would let browsers serve a stale
    # response for up to 60s after a mutation — the mutation happens on
    # a different URL, so nothing busts the browser entry. Falling
    # through to _DEFAULT_API_MAX_AGE = 0 keeps freshness correct; the
    # Redis cache still makes revalidation (ETag → 304) nearly free.
    # Analytics endpoints are heavy aggregations that don't need second-
    # fresh data — Trends / Forecast / Drive Optimization share a prefix.
    "/api/v1/analytics": 30,
}
_DEFAULT_API_MAX_AGE = 0  # default: must-revalidate (ETag only)


@app.middleware("http")
async def cache_control_middleware(request: Request, call_next):
    """Add Cache-Control and ETag headers to GET API responses."""
    response = await call_next(request)

    if request.method != "GET" or not request.url.path.startswith("/api"):
        return response

    # Determine max-age for this path
    max_age = _DEFAULT_API_MAX_AGE
    for prefix, age in _CACHE_MAX_AGE.items():
        if request.url.path.startswith(prefix):
            max_age = age
            break

    response.headers["Cache-Control"] = f"private, max-age={max_age}, must-revalidate"

    # Generate ETag from response body for small responses
    if getattr(response, "body", None) is not None and len(response.body) < 256_000:
        etag = '"' + _hashlib.md5(response.body).hexdigest()[:16] + '"'
        response.headers["ETag"] = etag

        # Check If-None-Match
        if_none_match = request.headers.get("if-none-match")
        if if_none_match and if_none_match == etag:
            from starlette.responses import Response as StarletteResponse
            return StarletteResponse(status_code=304, headers={"ETag": etag})

    return response


_IS_PRODUCTION = (
    os.getenv("ENVIRONMENT", "development") == "production"
    or bool(os.getenv("RAILWAY_ENVIRONMENT"))
)

# In production, remove 'unsafe-inline' from script-src.
# style-src keeps 'unsafe-inline' because Tailwind/React use inline styles.
_script_src = "script-src 'self' https:;" if _IS_PRODUCTION else "script-src 'self' 'unsafe-inline' https:;"
_CSP = (
    "default-src 'self'; "
    + _script_src + " "
    "style-src 'self' 'unsafe-inline' https:; "
    "img-src 'self' data: https: blob:; "
    "font-src 'self' https: data:; "
    "connect-src 'self' https:; "
    "worker-src 'self' blob:; "
    # Allow same-origin and blob: in <iframe> — the attachment previewer
    # embeds same-origin download URLs (internal) and blob: URLs built
    # from bearer-authed downloads (portal).
    "frame-src 'self' blob:; "
    "frame-ancestors 'none'"
)

# Per-response override for attachment preview: the default ``frame-ancestors
# 'none'`` blocks even same-origin iframing, which the in-app preview needs.
_CSP_INLINE_FRAME = _CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")


def _is_inline_attachment_download(request: Request) -> bool:
    # Match the three download endpoints when the client opts into inline
    # disposition via ``?inline=true``. Keep the set narrow so no other
    # route accidentally inherits relaxed frame headers.
    if request.query_params.get("inline") != "true":
        return False
    path = request.url.path
    return path.endswith("/download") and (
        "/attachments/" in path or "/documents/" in path
    )


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if _is_inline_attachment_download(request):
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Content-Security-Policy"] = _CSP_INLINE_FRAME
    else:
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = _CSP
    return response


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        request_id_var.reset(token)


def _validate_cors_origin(origin: str) -> None:
    """Refuse wildcard / partial / non-http origins at startup.

    ``allow_credentials=True`` paired with a wildcard or sloppy match would
    let any site read credentialed API responses. FastAPI already rejects
    ``*`` at the middleware level, but substring wildcards like
    ``https://*.example.com`` and path components are silently accepted —
    this catches them before the middleware sees them.
    """
    from urllib.parse import urlparse

    if "*" in origin:
        raise RuntimeError(
            f"CORS_ORIGINS contains wildcard '*' in {origin!r}; refuse startup."
            " Enumerate each allowed origin explicitly."
        )
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError(
            f"CORS_ORIGINS entry {origin!r} has non-http(s) scheme {parsed.scheme!r}."
        )
    if not parsed.netloc:
        raise RuntimeError(
            f"CORS_ORIGINS entry {origin!r} is missing a host."
        )
    if parsed.path and parsed.path != "/":
        raise RuntimeError(
            f"CORS_ORIGINS entry {origin!r} includes a path; strip it down to scheme+host."
        )
    if parsed.query or parsed.fragment:
        raise RuntimeError(
            f"CORS_ORIGINS entry {origin!r} includes query/fragment; strip it."
        )


cors_origins_str = os.getenv("CORS_ORIGINS", "")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
for _origin in origins:
    _validate_cors_origin(_origin)
if not origins:
    _env = os.getenv("ENVIRONMENT", "development")
    if _env == "production" or os.getenv("RAILWAY_ENVIRONMENT"):
        logger.warning(
            "CORS_ORIGINS is not set in production. Defaulting to reject cross-origin requests. "
            "Set CORS_ORIGINS to a comma-separated list of allowed origins."
        )
        origins = []  # No cross-origin requests allowed
    else:
        origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

# Response compression. Added BEFORE CORS so that CORS remains the last
# registered middleware and therefore the outermost wrapper on the ASGI
# stack — Starlette inserts each new middleware at the head of the list,
# so "added last == outermost". Keeping CORS outermost matters for
# preflight handling; gzip still sees every response body because it
# sits immediately inside CORS. The 1 KB floor skips trivial bodies
# where the fixed encoding overhead would dominate.
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(locations.router)
api_router.include_router(employees.router)
api_router.include_router(classes.router)
api_router.include_router(schedules.router)
api_router.include_router(reports.router)
api_router.include_router(system.router)
api_router.include_router(analytics.router)
api_router.include_router(users.router)
api_router.include_router(google_oauth.router)
api_router.include_router(outlook_oauth.router)
api_router.include_router(partner_orgs.router)
api_router.include_router(projects.router)
api_router.include_router(project_tasks.router)
api_router.include_router(project_docs.router)
api_router.include_router(project_members.router)
api_router.include_router(project_messages.router)
api_router.include_router(portal.router)
api_router.include_router(projects.templates_router)
api_router.include_router(exports.router)
api_router.include_router(event_outcomes.router)
api_router.include_router(promotion_checklist.router)
api_router.include_router(webhooks.router)
api_router.include_router(notification_preferences.router)


_WORKER_HEARTBEAT_KEY = "arq:heartbeat"
_WORKER_HEARTBEAT_MAX_AGE_SECONDS = 90


async def _check_worker_heartbeat() -> str:
    """Return ``"ok"`` when the worker is alive, ``"stale"`` when its
    last heartbeat is older than ``_WORKER_HEARTBEAT_MAX_AGE_SECONDS``,
    ``"missing"`` when there's no heartbeat at all, and ``"unknown"``
    when Redis itself is unreachable (so we don't misattribute a Redis
    outage to a worker outage).
    """
    try:
        from core.queue import get_redis_pool
        pool = await get_redis_pool()
        if pool is None:
            return "unknown"
        raw = await pool.get(_WORKER_HEARTBEAT_KEY)
        if raw is None:
            return "missing"
        if isinstance(raw, bytes):
            raw = raw.decode()
                last = datetime.fromisoformat(raw)
        age = (datetime.now(timezone.utc) - last).total_seconds()
        if age > _WORKER_HEARTBEAT_MAX_AGE_SECONDS:
            return "stale"
        return "ok"
    except Exception:
        return "unknown"


@api_router.get("/csrf-token", tags=["system"])
async def get_csrf_token(request: Request):
    """Return the current CSRF token.

    The ``csrf_token`` cookie is **intentionally not HttpOnly** — the
    double-submit pattern requires the SPA to read the value from
    ``document.cookie`` and echo it in the ``X-CSRF-Token`` header on
    mutating requests, where the middleware compares the two. This
    endpoint exists for clients that prefer not to parse
    ``document.cookie`` directly and for forcing a rotation on demand.

    (If you're tempted to "harden" the middleware by flipping
    ``httponly=True``: don't. Every mutating request from the SPA
    would 403 because the frontend would no longer be able to read
    the cookie to echo it. The HMAC signature on the token + the
    ``SameSite=Lax`` flag are the real defences.)
    """
    # Generate a fresh token here and pin the middleware to use the
    # same value in its rotation, so the response body and Set-Cookie
    # header agree. Returning the incoming cookie would be stale
    # seconds later when the middleware rewrites the cookie.
    token = generate_csrf_token()
    request.state.csrf_token_override = token
    return {"csrf_token": token}


# Mount the readiness probe under both ``/ready`` (legacy) and ``/readyz``
# (Kubernetes/Railway convention) so ops tooling can use whichever name
# their template defaults to without us having to maintain two impls.
@api_router.get("/ready", tags=["system"])
@api_router.get("/readyz", tags=["system"])
async def readiness_check(request: Request):
    """Readiness probe — 503 if any hard dependency (Mongo, Redis) is down.

    Distinct from ``/health`` so orchestrators can remove the pod from the
    load balancer (readiness) without killing the container (liveness).
    Worker heartbeat is intentionally excluded — a degraded worker should
    not pull the API out of LB rotation.
    """
    checks = {"status": "ready", "mongo": "ok", "redis": "ok"}
    try:
        await client.admin.command("ping")
    except Exception:
        checks["mongo"] = "unavailable"
        checks["status"] = "not_ready"
    if not await _probe_redis(request.app):
        checks["redis"] = "unavailable"
        checks["status"] = "not_ready"
    status_code = 200 if checks["status"] == "ready" else 503
    return JSONResponse(content=checks, status_code=status_code)


@api_router.get("/livez", tags=["system"])
async def liveness_check():
    """Liveness probe — process is alive. Always 200 if the app is up."""
    return {"status": "alive"}


@api_router.get("/health", tags=["system"])
async def health_check(request: Request):
    """Health check endpoint for load balancers and deployment monitoring.

    ``_probe_redis`` lazily reconnects a cached Redis client that's gone
    stale (or was never created because Redis was down at startup), so a
    transient Redis outage does not pin ``/health`` to 503 until the next
    container restart.

    Worker liveness is inferred from the Redis heartbeat key the arq
    worker writes on every cron tick. A stale or missing heartbeat flips
    ``status`` to ``degraded`` so orchestrators can re-cycle the worker
    pod without taking down the API.
    """
    checks = {"status": "healthy", "mongo": "ok", "redis": "ok", "worker": "ok"}
    api_degraded = False
    try:
        await client.admin.command("ping")
    except Exception:
        checks["mongo"] = "unavailable"
        api_degraded = True

    if not await _probe_redis(request.app):
        checks["redis"] = "unavailable"
        api_degraded = True

    worker_status = await _check_worker_heartbeat()
    checks["worker"] = worker_status
    # A stale or missing worker heartbeat is reported in the JSON so
    # operators can see it and load balancers that inspect payload can
    # recycle the worker pod — but we deliberately do NOT 503 the API
    # here. Killing the API container because the *worker* is down would
    # take scheduling offline for everyone even though the API itself is
    # fine. Redis outages still flip the status, since API-critical
    # features (CSRF validation, rate limiting) rely on Redis.
    if api_degraded:
        checks["status"] = "degraded"
    elif worker_status in {"stale", "missing"}:
        # API-healthy but worker signal is off: use a distinct status
        # string so dashboards can alert without mis-scaling the API.
        checks["status"] = "worker_degraded"

    status_code = 503 if api_degraded else 200
    return JSONResponse(content=checks, status_code=status_code)

# ========== APP SETUP ==========

app.include_router(api_router)

# Backward-compatible: mount same routes under /api/ for existing clients
# DEPRECATED: These legacy routes will be removed in a future release.
# Migrate all clients to /api/v1/ endpoints.
legacy_router = APIRouter(prefix="/api")
for sub_router in [auth.router, locations.router, employees.router, classes.router,
                   schedules.router, reports.router, system.router, analytics.router, users.router]:
    legacy_router.include_router(sub_router)


@legacy_router.get("/health", tags=["system"], include_in_schema=False)
async def health_check_legacy(request: Request):
    """Backward-compat health check at /api/health."""
    return await health_check(request)

app.include_router(legacy_router)

# RFC 8594 (Sunset) + draft Deprecation header advertise the planned removal
# of the legacy ``/api/*`` mount. Clients that still call it see the warning
# on every response; we also log the first hit per path so we can track
# real-world traffic before the hard removal in a future release.
_LEGACY_SUNSET = "Wed, 01 Jul 2026 00:00:00 GMT"
_LEGACY_WARNED_PATHS: set[str] = set()


@app.middleware("http")
async def legacy_api_deprecation_middleware(request: Request, call_next):
    path = request.url.path
    is_legacy = (
        path.startswith("/api/")
        and not path.startswith("/api/v1/")
        and not path.startswith("/api/docs")
    )
    response = await call_next(request)
    if is_legacy:
        response.headers["Deprecation"] = "true"
        response.headers["Sunset"] = _LEGACY_SUNSET
        response.headers["Link"] = '</api/v1/>; rel="successor-version"'
        if path not in _LEGACY_WARNED_PATHS:
            _LEGACY_WARNED_PATHS.add(path)
            logger.warning(
                "Legacy /api/ route hit: %s — migrate clients to /api/v1/",
                path,
            )
    return response

# Serve frontend static files (built React app)
_static_dir = ROOT_DIR / "static"
# Serving built frontend assets
if (_static_dir / "static").exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir / "static")), name="frontend-static")
elif (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="frontend-assets")

    # Build an allow-set of real files under static_root at startup so
    # serve_frontend never joins user input into a path at all.
    _static_root_resolved = _static_dir.resolve()
    _allowed_files: dict[str, str] = {}  # relative posix path -> absolute str
    if _static_root_resolved.exists():
        for p in _static_root_resolved.rglob("*"):
            if p.is_file():
                rel = p.relative_to(_static_root_resolved).as_posix()
                _allowed_files[rel] = str(p)

    # Hashed Vite chunks are content-addressed; everything under /assets
    # can be cached forever. index.html must NOT be cached — otherwise a
    # browser holding onto stale HTML after a deploy keeps requesting
    # chunk hashes that no longer exist, which is exactly how users end
    # up with "Failed to fetch dynamically imported module" on idle tabs.
    _CACHE_CONTROL_HEADER = "Cache-Control"
    _IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
    _HTML_CACHE = "no-cache"

    _INDEX_HTML_PATH = str(_static_root_resolved / "index.html")

    def _cache_for(full_path: str, resolved: str | None) -> str | None:
        """Return the Cache-Control value for a served path, or None.

        index.html (and the SPA fallback, which serves it) must revalidate
        on every request so a new deploy is picked up immediately. Hashed
        /assets/ files are content-addressed and safe to cache forever.
        """
        if (
            resolved is None
            or full_path == "index.html"
            or full_path.endswith(".html")
        ):
            return _HTML_CACHE
        if full_path.startswith("assets/"):
            return _IMMUTABLE_CACHE
        return None

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Look up the request path in the pre-built allow-set.
        # No user input is ever joined to a filesystem path.
        resolved = _allowed_files.get(full_path)
        target = resolved if resolved is not None else _INDEX_HTML_PATH
        cache_value = _cache_for(full_path, resolved)
        headers = (
            {_CACHE_CONTROL_HEADER: cache_value}
            if cache_value is not None
            else None
        )
        return FileResponse(target, headers=headers)
