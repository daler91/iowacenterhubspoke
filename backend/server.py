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
from routers import auth, locations, employees, classes, schedules, reports, system, analytics, users, google_oauth  # noqa: E402
from core.constants import ROLE_ADMIN, USER_STATUS_APPROVED, DEFAULT_REDIS_URL  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- Startup ----
    try:
        await client.admin.command('ping')
        logger.info("Connected to MongoDB")
    except Exception as e:
        logger.error("Failed to connect to MongoDB", exc_info=e)
        raise

    # Migrate existing users: set status to approved if missing
    try:
        result = await db.users.update_many(
            {"status": {"$exists": False}},
            {"$set": {"status": USER_STATUS_APPROVED}}
        )
        if result.modified_count > 0:
            logger.info(f"Migrated {result.modified_count} existing users to approved status")
    except Exception as e:
        logger.warning(f"Failed to migrate user statuses: {e}")

    # Auto-promote admin email (configurable via env var)
    admin_email = os.getenv("ADMIN_EMAIL")
    if admin_email:
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

    # Create required indexes
    try:
        await db.schedules.create_index([("employee_id", 1), ("date", 1)])
        await db.schedules.create_index([("employee_id", 1), ("date", 1), ("deleted_at", 1)])
        await db.schedules.create_index([("location_id", 1), ("date", 1)])
        await db.schedules.create_index([("date", 1), ("status", 1)])
        await db.schedules.create_index([("deleted_at", 1)])
        await db.employees.create_index([("deleted_at", 1)])
        await db.locations.create_index([("deleted_at", 1)])
        await db.classes.create_index([("deleted_at", 1)])
        await db.activity_logs.create_index([("timestamp", -1)])
        await db.activity_logs.create_index([("entity_type", 1), ("entity_id", 1)])
        await db.drive_time_cache.create_index("key", unique=True)
        # TTL index: auto-delete cache entries after 30 days
        await db.drive_time_cache.create_index(
            "expires_at", expireAfterSeconds=0
        )
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("email")
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=600)
        logger.info("Ensured indexes on all collections")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")

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

    yield

    # ---- Shutdown ----
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

    # Set/refresh CSRF cookie on every response if not present
    if not request.cookies.get("csrf_token"):
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
    if hasattr(response, "body"):
        etag = '"' + _hashlib.md5(response.body).hexdigest()[:16] + '"'
        response.headers["ETag"] = etag

        # Check If-None-Match
        if_none_match = request.headers.get("if-none-match")
        if if_none_match and if_none_match == etag:
            from starlette.responses import Response as StarletteResponse
            return StarletteResponse(status_code=304, headers={"ETag": etag})

    return response


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https:; "
        "style-src 'self' 'unsafe-inline' https:; "
        "img-src 'self' data: https: blob:; "
        "font-src 'self' https: data:; "
        "connect-src 'self' https:; "
        "worker-src 'self' blob:; "
        "frame-ancestors 'none'"
    )
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
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


@api_router.get("/health", tags=["system"])
async def health_check():
    """Health check endpoint for load balancers and deployment monitoring."""
    checks = {"status": "healthy", "mongo": "ok", "redis": "ok"}
    try:
        await client.admin.command("ping")
    except Exception:
        checks["mongo"] = "unavailable"
        checks["status"] = "degraded"

    try:
        import redis as _redis
        redis_url = os.getenv("REDIS_URL", DEFAULT_REDIS_URL)
        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
    except Exception:
        checks["redis"] = "unavailable"
        checks["status"] = "degraded"

    status_code = 200 if checks["status"] == "healthy" else 503
    return JSONResponse(content=checks, status_code=status_code)

# ========== APP SETUP ==========

app.include_router(api_router)

# Backward-compatible: mount same routes under /api/ for existing clients
legacy_router = APIRouter(prefix="/api")
for sub_router in [auth.router, locations.router, employees.router, classes.router,
                   schedules.router, reports.router, system.router, analytics.router, users.router]:
    legacy_router.include_router(sub_router)


@legacy_router.get("/health", tags=["system"], include_in_schema=False)
async def health_check_legacy():
    """Backward-compat health check at /api/health."""
    return await health_check()

app.include_router(legacy_router)

# Serve frontend static files (built React app)
_static_dir = ROOT_DIR / "static"
# Serving built frontend assets
if (_static_dir / "static").exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir / "static")), name="frontend-static")
elif (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = _static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_static_dir / "index.html"))
