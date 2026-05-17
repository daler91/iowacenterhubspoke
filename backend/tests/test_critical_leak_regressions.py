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

from routers import exports  # noqa: E402
from routers.portal import documents as portal_documents  # noqa: E402
from startup.indexes import _ensure_partial_unique_token_index  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.find_query = None

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    def find(self, query, projection=None):
        del projection
        self.find_query = query
        return _Cursor([row for row in self.rows if _matches(row, query)])


def _matches(row, query):
    return all(row.get(key) == value for key, value in query.items())


def _project(row, projection):
    out = dict(row)
    if projection:
        for key, enabled in projection.items():
            if enabled == 0:
                out.pop(key, None)
    return out


def test_portal_document_download_hides_soft_deleted_shared_docs(monkeypatch):
    monkeypatch.setattr(
        portal_documents,
        "_require_partner_project",
        AsyncMock(return_value={"id": "p1", "partner_org_id": "org1"}),
    )
    fake_db = SimpleNamespace(
        documents=_Collection(
            [
                {
                    "id": "doc-1",
                    "project_id": "p1",
                    "visibility": "shared",
                    "deleted_at": "2026-01-01T00:00:00+00:00",
                    "file_path": "deleted.pdf",
                }
            ]
        )
    )
    monkeypatch.setattr(portal_documents, "db", fake_db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            portal_documents.portal_download_document(
                "p1",
                "doc-1",
                {"partner_org_id": "org1"},
            )
        )

    assert exc.value.status_code == 404


def test_outcomes_export_filters_soft_deleted_rows(monkeypatch):
    event_outcomes = _Collection(
        [
            {"id": "live", "project_id": "p1", "deleted_at": None},
            {"id": "deleted", "project_id": "p1", "deleted_at": "2026-01-01T00:00:00+00:00"},
        ]
    )
    monkeypatch.setattr(exports, "db", SimpleNamespace(event_outcomes=event_outcomes))

    asyncio.run(exports.export_outcomes({"user_id": "u1"}, project_id="p1"))

    assert event_outcomes.find_query == {"deleted_at": None, "project_id": "p1"}


def test_token_indexes_are_partial_so_digest_only_rows_can_coexist():
    class _IndexCollection:
        def __init__(self):
            self.dropped = []
            self.created = []

        async def index_information(self):
            await asyncio.sleep(0)
            return {"token_1": {"key": [("token", 1)], "unique": True}}

        async def drop_index(self, name):
            await asyncio.sleep(0)
            self.dropped.append(name)

        async def create_index(self, field, **kwargs):
            await asyncio.sleep(0)
            self.created.append((field, kwargs))

    collection = _IndexCollection()

    asyncio.run(_ensure_partial_unique_token_index(collection, "token"))

    assert collection.dropped == ["token_1"]
    assert collection.created == [
        (
            "token",
            {
                "unique": True,
                "name": "token_1",
                "partialFilterExpression": {
                    "token": {"$exists": True, "$type": "string"},
                },
            },
        )
    ]
