import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncio
import pytest
from fastapi import HTTPException

sys.path.append(os.path.abspath("backend"))

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from core import portal_auth
from routers.portal import auth as portal_auth_router


def test_verify_response_never_includes_token_material():
    out = asyncio.run(portal_auth_router.verify_token({"contact": {"id": "c1"}, "org": {"id": "o1"}}))
    assert out["valid"] is True
    assert "token" not in out
    assert "access_token" not in out


def test_verify_route_is_not_path_token_based_anymore():
    verify_paths = [r.path for r in portal_auth_router.router.routes if getattr(r, "name", "") == "verify_token"]
    assert "/portal/auth/verify" in verify_paths
    assert "/portal/auth/verify/{token}" not in verify_paths


def test_bearer_dependency_rejects_missing_or_non_bearer_header():
    request = SimpleNamespace(headers={}, client=None)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(portal_auth.get_portal_context_from_bearer(request=request, authorization=""))
    assert exc.value.status_code == 401

    with pytest.raises(HTTPException) as exc2:
        asyncio.run(portal_auth.get_portal_context_from_bearer(request=request, authorization="Basic abc"))
    assert exc2.value.status_code == 401


def test_bearer_dependency_uses_authorization_header_only(monkeypatch):
    seen = {}

    async def fake_validate(token: str, request=None):
        seen["token"] = token
        return {"contact": {"id": "c1"}, "org": {"id": "o1"}}

    monkeypatch.setattr(portal_auth, "validate_portal_token", fake_validate)
    request = SimpleNamespace(headers={"x-forwarded-for": "127.0.0.1"}, client=None)
    out = asyncio.run(portal_auth.get_portal_context_from_bearer(
        request=request,
        authorization="Bearer from-header-token",
    ))
    assert seen["token"] == "from-header-token"
    assert out["contact"]["id"] == "c1"
