import os
os.environ["JWT_SECRET"] = "test_secret"

import pytest
from httpx import AsyncClient
from server import app
from core.auth import create_token
import uuid

@pytest.fixture
def viewer_token():
    return create_token(str(uuid.uuid4()), "viewer@example.com", "Viewer User", "viewer")

@pytest.fixture
def scheduler_token():
    return create_token(str(uuid.uuid4()), "scheduler@example.com", "Scheduler User", "scheduler")

@pytest.fixture
def admin_token():
    return create_token(str(uuid.uuid4()), "admin@example.com", "Admin User", "admin")

@pytest.mark.asyncio
async def test_viewer_permissions():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        token = create_token(str(uuid.uuid4()), "v@e.com", "V", "viewer")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to GET
        res = await ac.get("/api/v1/schedules", headers=headers)
        assert res.status_code == 200
        
        # Should NOT be able to POST schedule
        res = await ac.post("/api/v1/schedules", json={}, headers=headers)
        assert res.status_code == 403
        
        # Should NOT be able to POST employee
        res = await ac.post("/api/v1/employees", json={}, headers=headers)
        assert res.status_code == 403

@pytest.mark.asyncio
async def test_scheduler_permissions():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        token = create_token(str(uuid.uuid4()), "s@e.com", "S", "scheduler")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to GET
        res = await ac.get("/api/v1/schedules", headers=headers)
        assert res.status_code == 200
        
        # Should be able to POST schedule (will fail with 422/404 because empty json, but shouldn't be 403)
        res = await ac.post("/api/v1/schedules", json={}, headers=headers)
        assert res.status_code in [404, 422] # 404 if it tries to find location, 422 if pydantic fails
        
        # Should NOT be able to POST employee
        res = await ac.post("/api/v1/employees", json={}, headers=headers)
        assert res.status_code == 403

@pytest.mark.asyncio
async def test_admin_permissions():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        token = create_token(str(uuid.uuid4()), "a@e.com", "A", "admin")
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to POST employee (validation error or not found, but not 403)
        res = await ac.post("/api/v1/employees", json={}, headers=headers)
        assert res.status_code != 403
