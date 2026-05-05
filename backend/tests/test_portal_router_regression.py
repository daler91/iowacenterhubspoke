import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncio

sys.path.append(os.path.abspath("backend"))

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from routers import portal  # noqa: E402
from routers.portal import auth as portal_auth_router  # noqa: E402
from routers.portal import dashboard as portal_dashboard_router  # noqa: E402


def test_portal_route_paths_are_preserved_after_modularization():
    route_methods: dict[str, set[str]] = {}
    for route in portal.router.routes:
        route_methods.setdefault(route.path, set()).update(route.methods or set())

    expected = {
        "/portal/auth/request-link": {"POST"},
        "/portal/auth/verify": {"GET"},
        "/portal/auth/tokens": {"GET"},
        "/portal/auth/tokens/{token_id}": {"DELETE"},
        "/portal/dashboard": {"GET"},
        "/portal/projects": {"GET"},
        "/portal/projects/{project_id}/tasks": {"GET"},
        "/portal/projects/tasks/bulk": {"POST"},
        "/portal/projects/{project_id}/tasks/{task_id}/complete": {"PATCH"},
        "/portal/projects/{project_id}/tasks/{task_id}": {"GET", "PATCH"},
        "/portal/projects/{project_id}/tasks/{task_id}/attachments": {"GET", "POST"},
        "/portal/projects/{project_id}/tasks/{task_id}/comments": {"GET", "POST"},
        "/portal/projects/{project_id}/members": {"GET"},
        "/portal/projects/{project_id}/documents": {"GET", "POST"},
        "/portal/projects/{project_id}/documents/{doc_id}/download": {"GET"},
        "/portal/org-documents": {"GET"},
        "/portal/projects/{project_id}/messages": {"GET", "POST"},
    }

    missing_paths = [path for path in expected if path not in route_methods]
    assert not missing_paths, f"Missing expected portal route paths: {sorted(missing_paths)}"

    missing_methods = []
    for path, methods in expected.items():
        if not methods.issubset(route_methods[path]):
            missing_methods.append((path, sorted(methods - route_methods[path])))
    assert not missing_methods, f"Missing expected HTTP methods: {missing_methods}"


def test_verify_token_response_contract_remains_stable():
    ctx = {"contact": {"id": "c1", "name": "Partner"}, "org": {"id": "o1", "name": "Org"}}
    out = asyncio.run(portal_auth_router.verify_token(ctx))

    assert set(out.keys()) == {"valid", "contact", "org"}
    assert out["valid"] is True
    assert out["contact"] == ctx["contact"]
    assert out["org"] == ctx["org"]


def test_dashboard_response_contract_remains_stable(monkeypatch):
    fake_projects_cursor = SimpleNamespace(sort=lambda *_args, **_kwargs: SimpleNamespace(to_list=AsyncMock(return_value=[])))
    fake_db = SimpleNamespace(
        projects=SimpleNamespace(find=MagicMock(return_value=fake_projects_cursor)),
        tasks=SimpleNamespace(count_documents=AsyncMock(return_value=0)),
    )
    monkeypatch.setattr(portal_dashboard_router, "db", fake_db)

    ctx = {"partner_org_id": "org1", "org": {"id": "org1"}, "contact": {"id": "c1"}}
    out = asyncio.run(portal_dashboard_router.portal_dashboard(ctx))

    assert set(out.keys()) == {
        "org",
        "contact",
        "upcoming_classes",
        "open_tasks",
        "overdue_tasks",
        "classes_hosted",
        "projects",
    }
    assert out["org"] == ctx["org"]
    assert out["contact"] == ctx["contact"]
