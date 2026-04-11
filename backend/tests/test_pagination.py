"""Tests for the shared pagination dependency.

Covers the FastAPI ``pagination_params`` factory (which pipes values through
``fastapi.Query`` validators) and the ``paginated_response`` envelope helper.
Validator bounds are exercised end-to-end so any future regression to
"unbounded limit accepted" is caught by the suite.
"""

import os
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_db")
os.environ.setdefault("JWT_SECRET", "test_secret")

# A sibling test (`test_drive_time_unit.py`) mocks ``httpx`` via
# ``sys.modules.setdefault``. If that test runs first in the same pytest
# session, ``starlette.testclient`` fails to import with a cryptic
# "metaclass conflict" because its ``WebSocketDenialResponse`` inherits
# from classes that transitively depend on the real ``httpx`` types.
# Drop the mock (and any already-imported starlette/fastapi test clients)
# so the real modules load fresh below.
for _poisoned in (
    "httpx",
    "starlette.testclient",
    "fastapi.testclient",
):
    sys.modules.pop(_poisoned, None)

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from core.pagination import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    PaginationParams,
    pagination_params,
    paginated_response,
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = FastAPI()

    @app.get("/items")
    async def list_items(pagination: PaginationParams = Depends(pagination_params)):
        return paginated_response(
            [{"id": i} for i in range(pagination.limit)],
            total=1000,
            pagination=pagination,
        )

    return TestClient(app)


def test_default_pagination(client: TestClient):
    res = client.get("/items")
    assert res.status_code == 200
    body = res.json()
    assert body["skip"] == 0
    assert body["limit"] == DEFAULT_PAGE_SIZE
    assert body["total"] == 1000
    assert len(body["items"]) == DEFAULT_PAGE_SIZE


def test_limit_is_clamped_at_max(client: TestClient):
    # A limit above MAX_PAGE_SIZE must be rejected — we do NOT silently clamp
    # because silent clamping masks client bugs that assume they got more
    # data than they did.
    res = client.get("/items", params={"limit": MAX_PAGE_SIZE + 1})
    assert res.status_code == 422


def test_limit_exactly_at_max(client: TestClient):
    res = client.get("/items", params={"limit": MAX_PAGE_SIZE})
    assert res.status_code == 200
    assert res.json()["limit"] == MAX_PAGE_SIZE


def test_limit_zero_rejected(client: TestClient):
    res = client.get("/items", params={"limit": 0})
    assert res.status_code == 422


def test_negative_skip_rejected(client: TestClient):
    res = client.get("/items", params={"skip": -1})
    assert res.status_code == 422


def test_valid_skip_and_limit(client: TestClient):
    res = client.get("/items", params={"skip": 100, "limit": 25})
    assert res.status_code == 200
    body = res.json()
    assert body["skip"] == 100
    assert body["limit"] == 25
    assert len(body["items"]) == 25


def test_paginated_response_envelope_shape():
    """Unit test the envelope helper independent of FastAPI."""
    p = PaginationParams(skip=10, limit=5)
    response = paginated_response(
        [{"id": 1}, {"id": 2}],
        total=42,
        pagination=p,
    )
    assert response == {
        "items": [{"id": 1}, {"id": 2}],
        "total": 42,
        "skip": 10,
        "limit": 5,
    }
