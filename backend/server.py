import os
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import logging
import uuid
from datetime import datetime, timezone

# Set up logging early just in case
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

from database import client, db, mongo_url, ROOT_DIR
from routers import auth, locations, employees, classes, schedules, reports, system

app = FastAPI()

cors_origins_str = os.getenv("CORS_ORIGINS", "")
origins = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https:;"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(locations.router)
api_router.include_router(employees.router)
api_router.include_router(classes.router)
api_router.include_router(schedules.router)
api_router.include_router(reports.router)
api_router.include_router(system.router)

# ========== SEED DATA ==========

@app.on_event("startup")
async def seed_data():
    try:
        await client.admin.command('ping')
        logger.info(f"Connected to MongoDB at {mongo_url}")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB at {mongo_url}: {e}")
        raise
    
    # Create required indexes
    try:
        await db.schedules.create_index([("employee_id", 1), ("date", 1)])
        logger.info("Ensured index on schedules collection for employee_id and date")
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
        file_path = _static_dir / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_static_dir / "index.html"))

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
