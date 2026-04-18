"""RBAC enforcement tests.

These assert *only* the role gate — a POST with the wrong role returns
403 before the handler runs, and a POST with the right role reaches
the handler (where it may then 400/404/422/500 for unrelated reasons
like validation or a missing DB, all of which are acceptable "not a
role rejection" outcomes here).

End-to-end GET tests need a real MongoDB (Motor's collection lookup
resists straightforward mocking), so they live elsewhere.
"""

import pytest
import uuid
from httpx import AsyncClient, ASGITransport

from server import app
from core.auth import create_token
from core.constants import ROLE_VIEWER, ROLE_SCHEDULER, ROLE_ADMIN


def _auth(token: str, csrf_headers: dict) -> dict:
    """Build the header+cookie bundle that satisfies both JWT and CSRF."""
    return {
        "headers": {
            "Authorization": f"Bearer {token}",
            **csrf_headers["headers"],
        },
        "cookies": csrf_headers["cookies"],
    }


# A 403 means the role check itself rejected. A 404/422/5xx means the
# request got past RBAC and failed for an unrelated reason — fine here.
_NOT_A_ROLE_REJECTION = {200, 400, 404, 409, 422, 500, 503}


@pytest.mark.asyncio
async def test_docs_exists():
    """Sanity check: unauthenticated GET /docs returns the Swagger UI.

    Historically failed because SlowAPI's middleware referenced
    ``request.state.view_rate_limit`` on responses for endpoints that
    weren't decorated with ``@limiter.limit`` — now guarded by the
    ``_slowapi_state_init`` middleware in ``server.py``.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/docs")
        assert res.status_code == 200


@pytest.mark.asyncio
async def test_viewer_cannot_mutate(csrf_headers):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=True,
        cookies=csrf_headers["cookies"],
    ) as ac:
        token = create_token(str(uuid.uuid4()), "v@e.com", "V", ROLE_VIEWER)
        auth = _auth(token, csrf_headers)

        res = await ac.post("/api/schedules", json={}, headers=auth["headers"])
        assert res.status_code == 403, f"Viewer was allowed to POST schedule: {res.status_code}"

        res = await ac.post("/api/employees", json={}, headers=auth["headers"])
        assert res.status_code == 403, f"Viewer was allowed to POST employee: {res.status_code}"


@pytest.mark.asyncio
async def test_scheduler_can_schedule_but_not_manage_employees(csrf_headers):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=True,
        cookies=csrf_headers["cookies"],
    ) as ac:
        token = create_token(str(uuid.uuid4()), "s@e.com", "S", ROLE_SCHEDULER)
        auth = _auth(token, csrf_headers)

        # Scheduler → schedule endpoint: RBAC passes; handler may fail
        # on validation/lookups but must not 403.
        res = await ac.post("/api/schedules", json={}, headers=auth["headers"])
        assert res.status_code in _NOT_A_ROLE_REJECTION, (
            f"Scheduler was role-rejected on POST /api/schedules: {res.status_code}"
        )

        # Scheduler → employees: admin-only, should 403.
        res = await ac.post("/api/employees", json={}, headers=auth["headers"])
        assert res.status_code == 403, f"Scheduler was allowed to POST employee: {res.status_code}"


@pytest.mark.asyncio
async def test_admin_can_manage_employees(csrf_headers):
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        follow_redirects=True,
        cookies=csrf_headers["cookies"],
    ) as ac:
        token = create_token(str(uuid.uuid4()), "a@e.com", "A", ROLE_ADMIN)
        auth = _auth(token, csrf_headers)

        res = await ac.post("/api/employees", json={}, headers=auth["headers"])
        assert res.status_code in _NOT_A_ROLE_REJECTION, (
            f"Admin was role-rejected on POST /api/employees: {res.status_code}"
        )
