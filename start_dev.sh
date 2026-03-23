#!/bin/bash
export MONGO_URL=mongodb://localhost:27017
export DB_NAME=test_schedule_db
export JWT_SECRET=test_secret
# Note: we skip testing the actual mongo instance by mocking, or using motor directly.
# For manual frontend tests we just need the frontend server running if it runs without backend
# Oh wait, we should run the backend and the frontend to verify the websocket!

# Start mongo via docker just in case
docker run -d -p 27017:27017 --name mongo mongo:latest

cd backend
# Let's seed DB
python -c "
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os

async def seed():
    client = AsyncIOMotorClient('mongodb://localhost:27017')
    db = client.test_schedule_db
    # add a fake user
    import bcrypt
    from core.constants import ROLE_ADMIN, USER_STATUS_APPROVED
    pw = bcrypt.hashpw(b'password123', bcrypt.gensalt()).decode()
    await db.users.insert_one({'name': 'Admin', 'email': 'admin@example.com', 'hashed_password': pw, 'role': ROLE_ADMIN, 'status': USER_STATUS_APPROVED})
    # add fake location, employee, class
    import uuid
    loc_id = str(uuid.uuid4())
    emp_id = str(uuid.uuid4())
    cls_id = str(uuid.uuid4())
    await db.locations.insert_one({'id': loc_id, 'city_name': 'Test City', 'drive_time_minutes': 60, 'deleted_at': None})
    await db.employees.insert_one({'id': emp_id, 'name': 'John Doe', 'email': 'john@example.com', 'deleted_at': None})
    await db.classes.insert_one({'id': cls_id, 'name': 'Yoga', 'deleted_at': None})
asyncio.run(seed())
"
python -m uvicorn server:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ../frontend
yarn dev &
FRONTEND_PID=$!
sleep 10
