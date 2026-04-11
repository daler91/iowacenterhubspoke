import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uuid
from datetime import datetime, timezone

# Sentry error tracking (opt-in via SENTRY_DSN env var)
_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.2,
        environment=os.getenv("ENVIRONMENT", "development"),
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
    project_messages, portal,
    exports, event_outcomes, promotion_checklist, webhooks,
)
from core.constants import ROLE_ADMIN, USER_STATUS_APPROVED, DEFAULT_REDIS_URL  # noqa: E402


async def _run_startup_migrations():
    """Migrate existing users and promote admin if configured."""
    try:
        result = await db.users.update_many(
            {"status": {"$exists": False}},
            {"$set": {"status": USER_STATUS_APPROVED}}
        )
        if result.modified_count > 0:
            logger.info(f"Migrated {result.modified_count} existing users to approved status")
    except Exception as e:
        logger.warning(f"Failed to migrate user statuses: {e}")

    admin_email = os.getenv("ADMIN_EMAIL")
    if not admin_email:
        return
    try:
        existing_admin = await db.users.find_one({"email": admin_email})
        if existing_admin and existing_admin.get("role") != ROLE_ADMIN:
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"role": ROLE_ADMIN, "status": USER_STATUS_APPROVED}}
            )
            logger.info("Promoted configured admin user")
    except Exception as e:
        logger.warning(f"Failed to check/promote admin user: {e}")


async def _ensure_indexes():
    """Create required database indexes."""
    try:
        await db.schedules.create_index([("employee_ids", 1), ("date", 1)])
        await db.schedules.create_index([("employee_ids", 1), ("date", 1), ("deleted_at", 1)])
        await db.schedules.create_index([("location_id", 1), ("date", 1)])
        await db.schedules.create_index([("date", 1), ("status", 1)])
        await db.schedules.create_index([("deleted_at", 1)])
        await db.employees.create_index([("deleted_at", 1)])
        await db.locations.create_index([("deleted_at", 1)])
        await db.classes.create_index([("deleted_at", 1)])
        await db.activity_logs.create_index([("timestamp", -1)])
        await db.activity_logs.create_index([("entity_type", 1), ("entity_id", 1)])
        await db.drive_time_cache.create_index("key", unique=True)
        await db.drive_time_cache.create_index("expires_at", expireAfterSeconds=0)
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("email")
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=600)
        await db.outlook_oauth_states.create_index("created_at", expireAfterSeconds=600)
        # Coordination module indexes
        await db.projects.create_index([("partner_org_id", 1)])
        await db.projects.create_index([("phase", 1)])
        await db.projects.create_index([("community", 1)])
        await db.projects.create_index([("deleted_at", 1)])
        await db.tasks.create_index([("project_id", 1)])
        await db.tasks.create_index([("project_id", 1), ("phase", 1)])
        await db.tasks.create_index([("project_id", 1), ("completed", 1)])
        await db.partner_orgs.create_index([("community", 1)])
        await db.partner_orgs.create_index([("status", 1)])
        await db.partner_orgs.create_index([("deleted_at", 1)])
        await db.partner_contacts.create_index([("partner_org_id", 1)])
        await db.task_attachments.create_index([("task_id", 1)])
        await db.task_comments.create_index([("task_id", 1), ("created_at", 1)])
        # Phase 2 collections
        await db.email_reminders.create_index(
            [("task_id", 1), ("threshold_key", 1)], unique=True)
        await db.email_reminders.create_index([("sent_at", -1)])
        await db.event_outcomes.create_index([("project_id", 1)])
        await db.event_outcomes.create_index([("project_id", 1), ("status", 1)])
        await db.promotion_checklists.create_index("project_id", unique=True)
        await db.webhook_subscriptions.create_index([("active", 1), ("events", 1)])
        await db.webhook_subscriptions.create_index([("deleted_at", 1)])
        # Series and message visibility indexes
        await db.schedules.create_index([("series_id", 1), ("date", 1)])
        await db.messages.create_index([("project_id", 1), ("visibility", 1)])
        await db.webhook_logs.create_index([("subscription_id", 1), ("sent_at", -1)])
        await db.documents.create_index([("project_id", 1)])
        await db.messages.create_index([("project_id", 1), ("created_at", -1)])
        await db.portal_tokens.create_index("token", unique=True)
        await db.portal_tokens.create_index("expires_at", expireAfterSeconds=0)
        logger.info("Ensured indexes on all collections")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")


async def _seed_default_locations():
    """Seed default locations if the collection is empty."""
    try:
        count = await db.locations.count_documents({})
        if count == 0:
            default_locations = [
                {"id": str(uuid.uuid4()), "city_name": "Oskaloosa",
                 "drive_time_minutes": 75, "latitude": 41.2964,
                 "longitude": -92.6443, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Grinnell",
                 "drive_time_minutes": 60, "latitude": 41.7431,
                 "longitude": -92.7224, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Fort Dodge",
                 "drive_time_minutes": 105, "latitude": 42.4975,
                 "longitude": -94.1680, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Carroll",
                 "drive_time_minutes": 105, "latitude": 42.0664,
                 "longitude": -94.8669, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Marshalltown",
                 "drive_time_minutes": 60, "latitude": 42.0492,
                 "longitude": -92.9080, "created_at": datetime.now(timezone.utc).isoformat()},
            ]
            await db.locations.insert_many(default_locations)
            logger.info("Seeded default locations")
    except Exception as e:
        logger.warning(f"Failed to seed data (check MongoDB credentials): {e}")


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
            max_connections=5,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- Startup ----
    try:
        await client.admin.command('ping')
        logger.info("Connected to MongoDB")
    except Exception as e:
        logger.error("Failed to connect to MongoDB", exc_info=e)
        raise

    await _run_startup_migrations()
    from migrations.runner import run_pending as run_pending_migrations
    try:
        await run_pending_migrations(db)
    except Exception as e:
        logger.error("Migration runner failed; refusing to start", exc_info=e)
        raise
    await _ensure_indexes()
    await _seed_default_locations()

    from services.seed_templates import seed_project_templates
    await seed_project_templates()

    # Initialize a single Redis client for the health check and other
    # short-lived probes. Reusing one pooled client avoids per-request TLS
    # handshakes and lazy imports inside the async event loop. If Redis is
    # down at startup we log a warning and leave ``app.state.redis`` unset;
    # the health check lazily retries via ``_ensure_redis_client`` on the
    # next probe so transient boot-time outages heal themselves without a
    # container restart.
    app.state.redis = None
    await _ensure_redis_client(app)

    yield

    # ---- Shutdown ----
    from services.calendar_sync import background_tasks as _background_tasks
    if _background_tasks:
        logger.info("Waiting for %d pending calendar tasks to complete...", len(_background_tasks))
        import asyncio
        _, pending = await asyncio.wait(_background_tasks, timeout=10)
        if pending:
            logger.warning("Cancelling %d calendar tasks that didn't finish in time", len(pending))
            for task in pending:
                task.cancel()
    await _safe_aclose(getattr(app.state, "redis", None))
    client.close()


app = FastAPI(
    title="Iowa Center Hub & Spoke API",
    description=(
        "Scheduling platform for the Iowa Center's hub-and-spoke model. "
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

from core.auth import generate_csrf_token, validate_csrf_token  # noqa: E402

CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT_PATHS = {
    "/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/health",
    "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/logout", "/api/v1/health",
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

    # Rotate CSRF token on every response for stronger protection
    csrf_token = generate_csrf_token()
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,  # Must be readable by JavaScript
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
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
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

cors_origins_str = os.getenv("CORS_ORIGINS", "")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
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
api_router.include_router(project_messages.router)
api_router.include_router(portal.router)
api_router.include_router(projects.templates_router)
api_router.include_router(exports.router)
api_router.include_router(event_outcomes.router)
api_router.include_router(promotion_checklist.router)
api_router.include_router(webhooks.router)


@api_router.get("/health", tags=["system"])
async def health_check(request: Request):
    """Health check endpoint for load balancers and deployment monitoring.

    ``_probe_redis`` lazily reconnects a cached Redis client that's gone
    stale (or was never created because Redis was down at startup), so a
    transient Redis outage does not pin ``/health`` to 503 until the next
    container restart.
    """
    checks = {"status": "healthy", "mongo": "ok", "redis": "ok"}
    try:
        await client.admin.command("ping")
    except Exception:
        checks["mongo"] = "unavailable"
        checks["status"] = "degraded"

    if not await _probe_redis(request.app):
        checks["redis"] = "unavailable"
        checks["status"] = "degraded"

    status_code = 200 if checks["status"] == "healthy" else 503
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

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        static_root = _static_dir.resolve()
        normalized_path = os.path.normpath(full_path)

            file_path.relative_to(static_root)
        except (OSError, RuntimeError, ValueError):
        path_parts = [part for part in normalized_path.split(os.sep) if part not in ("", ".")]
        if os.path.isabs(normalized_path) or any(part == ".." for part in path_parts):
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
            file_path = (static_root / normalized_path).resolve()
        except (OSError, RuntimeError):
            return FileResponse(str(static_root / "index.html"))

        if str(file_path).startswith(str(static_root) + os.sep) or file_path == static_root:
            if file_path.exists() and file_path.is_file():
                return FileResponse(str(file_path))

        return FileResponse(str(static_root / "index.html"))
