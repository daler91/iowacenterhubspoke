import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ.get('MONGO_URL')
if not mongo_url:
    # Fail fast in production — a silent None URL would only surface as a
    # confusing connection error on the first real query. In development
    # and under pytest we allow a localhost fallback so tests that stub
    # motor (see tests/test_*.py) can still import this module.
    if os.environ.get('ENVIRONMENT') == 'production' or os.environ.get('RAILWAY_ENVIRONMENT'):
        raise RuntimeError(
            "MONGO_URL environment variable is required in production. "
            "Set it to a MongoDB connection string before starting the app."
        )
    mongo_url = 'mongodb://localhost:27017'

client = AsyncIOMotorClient(
    mongo_url,
    maxPoolSize=int(os.environ.get('MONGO_MAX_POOL_SIZE', '50')),
    minPoolSize=int(os.environ.get('MONGO_MIN_POOL_SIZE', '5')),
    serverSelectionTimeoutMS=int(os.environ.get('MONGO_SELECTION_TIMEOUT_MS', '5000')),
)
db = client[os.environ.get('DB_NAME', 'iowa_center_hub')]
