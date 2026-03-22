import os
os.environ["JWT_SECRET"] = "test_secret"

import pytest
from httpx import AsyncClient, ASGITransport
from server import app
from core.auth import create_token
from core.constants import ROLE_VIEWER, ROLE_SCHEDULER, ROLE_ADMIN
import uuid

@pytest.fixture
def viewer_token():
    return create_token(str(uuid.uuid4()), "viewer@example.com", "Viewer User", ROLE_VIEWER)

@pytest.fixture
def scheduler_token():
    return create_token(str(uuid.uuid4()), "scheduler@example.com", "Scheduler User", ROLE_SCHEDULER)

@pytest.fixture
def admin_token():
    return create_token(str(uuid.uuid4()), "admin@example.com", "Admin User", ROLE_ADMIN)

@pytest.mark.asyncio
async def test_docs_exists():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/docs")
        assert res.status_code == 200

@pytest.mark.asyncio
async def test_viewer_permissions():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=True) as ac:
        token = create_token(str(uuid.uuid4()), "v@e.com", "V", ROLE_VIEWER)
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to GET
        res = await ac.get("/api/schedules", headers=headers)
        assert res.status_code == 200
        
        # Should NOT be able to POST schedule
        res = await ac.post("/api/schedules", json={}, headers=headers)
        assert res.status_code == 403
        
        # Should NOT be able to POST employee
        res = await ac.post("/api/employees", json={}, headers=headers)
        assert res.status_code == 403

@pytest.mark.asyncio
async def test_scheduler_permissions():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=True) as ac:
        token = create_token(str(uuid.uuid4()), "s@e.com", "S", ROLE_SCHEDULER)
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to GET
        res = await ac.get("/api/schedules", headers=headers)
        assert res.status_code == 200
        
        # Should be able to POST schedule (will fail with 422/404 because empty json, but shouldn't be 403)
        res = await ac.post("/api/schedules", json={}, headers=headers)
        assert res.status_code in [404, 422] # 404 if it tries to find location, 422 if pydantic fails
        
        # Should NOT be able to POST employee
        res = await ac.post("/api/employees", json={}, headers=headers)
        assert res.status_code == 403

@pytest.mark.asyncio
async def test_admin_permissions():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=True) as ac:
        token = create_token(str(uuid.uuid4()), "a@e.com", "A", ROLE_ADMIN)
        headers = {"Authorization": f"Bearer {token}"}
        
        # Should be able to POST employee (validation error or not found, but not 403)
        res = await ac.post("/api/employees", json={}, headers=headers)
        assert res.status_code != 403
