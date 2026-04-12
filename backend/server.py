import os
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import logging
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

from core.logger import setup_logging, get_logger, request_id_var

# Set up JSON structured logging
setup_logging()
logger = get_logger(__name__)

from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from core.rate_limit import limiter

from database import client, db, mongo_url, ROOT_DIR
from routers import auth, locations, employees, classes, schedules, reports, system, analytics, users
from core.constants import ROLE_ADMIN, USER_STATUS_APPROVED

app = FastAPI()

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

from slowapi.middleware import SlowAPIMiddleware
app.add_middleware(SlowAPIMiddleware)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://maps.googleapis.com https://graph.microsoft.com; worker-src 'self' blob:;"
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
    if os.getenv("ENVIRONMENT") == "production" or os.getenv("RAILWAY_ENVIRONMENT"):
        logger.error("CORS_ORIGINS must be set in production")
        origins = []
    else:
        origins = ["http://localhost:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(locations.router)
api_router.include_router(employees.router)
api_router.include_router(classes.router)
api_router.include_router(schedules.router)
api_router.include_router(reports.router)
api_router.include_router(system.router)
api_router.include_router(analytics.router)
api_router.include_router(users.router)


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
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        r = _redis.from_url(redis_url, socket_connect_timeout=2)
        r.ping()
    except Exception:
        checks["redis"] = "unavailable"
        checks["status"] = "degraded"

    status_code = 200 if checks["status"] == "healthy" else 503
    return JSONResponse(content=checks, status_code=status_code)

# ========== SEED DATA ==========

@app.on_event("startup")
async def seed_data():
    try:
        await client.admin.command('ping')
        from urllib.parse import urlparse as _urlparse
        _parsed = _urlparse(mongo_url or "")
        _safe_url = f"{_parsed.scheme}://{_parsed.hostname}" if _parsed.hostname else "local"
        logger.info(f"Connected to MongoDB at {_safe_url}")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
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

    # Auto-promote admin email
    admin_email = os.getenv("ADMIN_EMAIL", "").strip()
    try:
        existing_admin = await db.users.find_one({"email": admin_email})
        if existing_admin and existing_admin.get("role") != ROLE_ADMIN:
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"role": ROLE_ADMIN, "status": USER_STATUS_APPROVED}}
            )
            logger.info(f"Promoted {admin_email} to admin role")
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
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("email")
        await db.users.create_index("email", unique=True)
        await db.schedules.create_index([("location_id", 1), ("date", 1), ("deleted_at", 1)])
        logger.info("Ensured indexes on all collections")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")

    try:
        count = await db.locations.count_documents({})
        if count == 0:
            default_locations = [
                {"id": str(uuid.uuid4()), "city_name": "Oskaloosa", "drive_time_minutes": 75, "latitude": 41.2964, "longitude": -92.6443, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Grinnell", "drive_time_minutes": 60, "latitude": 41.7431, "longitude": -92.7224, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Fort Dodge", "drive_time_minutes": 105, "latitude": 42.4975, "longitude": -94.1680, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Carroll", "drive_time_minutes": 105, "latitude": 42.0664, "longitude": -94.8669, "created_at": datetime.now(timezone.utc).isoformat()},
                {"id": str(uuid.uuid4()), "city_name": "Marshalltown", "drive_time_minutes": 60, "latitude": 42.0492, "longitude": -92.9080, "created_at": datetime.now(timezone.utc).isoformat()},
            ]
            await db.locations.insert_many(default_locations)
            logger.info("Seeded default locations")
    except Exception as e:
        logger.warning(f"Failed to seed data (check MongoDB credentials): {e}")

# ========== APP SETUP ==========

app.include_router(api_router)

# Serve frontend static files (built React app)
_static_dir = ROOT_DIR / "static"
# Serving built frontend assets
if (_static_dir / "static").exists():
    app.mount("/static", StaticFiles(directory=str(_static_dir / "static")), name="frontend-static")
elif (_static_dir / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="frontend-assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = (_static_dir / full_path).resolve()
        if file_path.is_relative_to(_static_dir.resolve()) and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_static_dir / "index.html"))

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
