"""Regressions for the Phase 3 correctness batch.

Each of these pins behaviour that was previously wrong in a way no existing
test would have caught.
"""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import webhooks as webhooks_service


class _Cursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def sort(self, *_a, **_k):
        return self

    async def to_list(self, _n):
        await asyncio.sleep(0)
        return list(self._rows)

    def __aiter__(self):
        async def _gen():
            for row in self._rows:
                yield row
        return _gen()


# ── webhook outbox drain ──────────────────────────────────────────────
# The outbox was written to when Redis was unavailable and then read by
# nothing — rows accumulated forever behind a comment claiming "for async
# processing".

def test_outbox_drain_enqueues_pending_rows_and_marks_them(monkeypatch):
    rows = [
        {"id": "o1", "subscription_id": "s1", "event": "task.completed", "payload": {"a": 1}},
        {"id": "o2", "subscription_id": "s2", "event": "project.created", "payload": {"b": 2}},
    ]
    updates = []

    async def _update_one(query, update):
        await asyncio.sleep(0)
        updates.append((query, update))

    fake_db = SimpleNamespace(webhook_outbox=SimpleNamespace(
        find=lambda *a, **k: _Cursor(rows),
        update_one=_update_one,
    ))
    monkeypatch.setattr(webhooks_service, "db", fake_db)

    pool = SimpleNamespace(enqueue_job=AsyncMock())
    monkeypatch.setattr(webhooks_service, "get_redis_pool", AsyncMock(return_value=pool))

    drained = asyncio.run(webhooks_service.drain_webhook_outbox())

    assert drained == 2
    # Must use the *registered* arq job name, not the service function name.
    assert pool.enqueue_job.await_args_list[0].args[0] == "deliver_webhook_job"
    assert [u[0]["id"] for u in updates] == ["o1", "o2"]
    assert all(u[1]["$set"]["status"] == "queued" for u in updates)


def test_outbox_drain_leaves_rows_pending_while_redis_is_down(monkeypatch):
    rows = [{"id": "o1", "subscription_id": "s1", "event": "e", "payload": {}}]
    updates = []

    async def _update_one(query, update):
        await asyncio.sleep(0)
        updates.append((query, update))

    fake_db = SimpleNamespace(webhook_outbox=SimpleNamespace(
        find=lambda *a, **k: _Cursor(rows),
        update_one=_update_one,
    ))
    monkeypatch.setattr(webhooks_service, "db", fake_db)
    monkeypatch.setattr(webhooks_service, "get_redis_pool", AsyncMock(return_value=None))

    assert asyncio.run(webhooks_service.drain_webhook_outbox()) == 0
    assert updates == [], "rows must stay pending so the next pass retries"


def test_outbox_drain_is_a_cheap_noop_when_empty(monkeypatch):
    fake_db = SimpleNamespace(webhook_outbox=SimpleNamespace(find=lambda *a, **k: _Cursor([])))
    monkeypatch.setattr(webhooks_service, "db", fake_db)
    get_pool = AsyncMock(return_value=None)
    monkeypatch.setattr(webhooks_service, "get_redis_pool", get_pool)

    assert asyncio.run(webhooks_service.drain_webhook_outbox()) == 0
    get_pool.assert_not_awaited(), "must not touch Redis when there is nothing to drain"


def test_outbox_row_created_at_is_a_native_datetime_for_ttl(monkeypatch):
    """A TTL index cannot expire an ISO string."""
    inserted = {}

    async def _insert_one(doc):
        await asyncio.sleep(0)
        inserted.update(doc)

    fake_db = SimpleNamespace(
        webhook_subscriptions=SimpleNamespace(find=lambda *a, **k: _Cursor([{"id": "s1"}])),
        webhook_outbox=SimpleNamespace(insert_one=_insert_one),
    )
    monkeypatch.setattr(webhooks_service, "db", fake_db)
    monkeypatch.setattr(webhooks_service, "get_redis_pool", AsyncMock(return_value=None))

    asyncio.run(webhooks_service.fire_webhook_event("task.completed", {}))

    assert isinstance(inserted["created_at"], datetime)


# ── partner export N+1 ────────────────────────────────────────────────

def test_partner_export_uses_one_contacts_query(monkeypatch):
    """Was one find() per org inside the loop — up to 1001 round trips."""
    from routers import exports

    orgs = [{"id": f"o{i}", "name": f"Org {i}"} for i in range(50)]
    contact_queries = []

    def _contacts_find(query, projection=None):
        contact_queries.append(query)
        return _Cursor([
            {"partner_org_id": "o0", "name": "A", "email": "a@e.com", "is_primary": True},
        ])

    fake_db = SimpleNamespace(
        partner_orgs=SimpleNamespace(find=lambda *a, **k: _Cursor(orgs)),
        partner_contacts=SimpleNamespace(find=_contacts_find),
    )
    monkeypatch.setattr(exports, "db", fake_db)
    monkeypatch.setattr(exports, "_respond", lambda df, fmt, name: df)

    df = asyncio.run(exports.export_partners(user={"role": "admin"}, format="csv"))

    assert len(contact_queries) == 1, f"expected 1 grouped query, got {len(contact_queries)}"
    assert "$in" in contact_queries[0]["partner_org_id"]
    assert len(df) == 50
    assert df.iloc[0]["primary_contact"] == "A"
    assert df.iloc[1]["primary_contact"] == ""


# ── boot-time index creation fails closed ─────────────────────────────

def test_ensure_indexes_raises_instead_of_booting_without_constraints():
    """One blanket except used to swallow a failure on the first index,
    silently skipping every uniqueness/TTL guard after it."""
    from startup import indexes as indexes_module

    class _Boom:
        def __getattr__(self, _name):
            raise AssertionError("should not be reached")

    class _FailingDB:
        def __getattr__(self, _name):
            return SimpleNamespace(
                create_index=AsyncMock(side_effect=RuntimeError("index failure")),
                drop_index=AsyncMock(side_effect=RuntimeError("nope")),
            )

    logger = SimpleNamespace(info=lambda *a, **k: None,
                             warning=lambda *a, **k: None,
                             error=lambda *a, **k: None)

    with pytest.raises(RuntimeError):
        asyncio.run(indexes_module.ensure_indexes(_FailingDB(), logger))


# ── login timing ──────────────────────────────────────────────────────

def test_unknown_user_login_still_pays_a_bcrypt_verification(monkeypatch):
    """Otherwise response time is an account-enumeration oracle."""
    from core import auth as auth_core

    calls = []
    monkeypatch.setattr(
        auth_core, "_verify_password_sync",
        lambda pw, hashed: calls.append((pw, hashed)) or False,
    )

    asyncio.run(auth_core.verify_password_dummy())

    assert len(calls) == 1
    assert calls[0][1] == auth_core._DUMMY_PASSWORD_HASH
    assert auth_core._DUMMY_PASSWORD_HASH.startswith("$2")
