"""Digest worker tests — flush-timing + row clearing.

The digest cron should only flush a principal's queue when "now" matches
their configured ``digest.daily_hour`` / ``digest.weekly_day``. Successful
flushes delete the rows; failed sends leave them for retry.
"""

import asyncio
import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest  # noqa: E402

from services import digest as digest_mod  # noqa: E402
from services.notification_prefs import Principal  # noqa: E402


class _Cursor:
    """Minimal Motor cursor stand-in exposing only ``to_list``."""

    def __init__(self, items):
        self.items = items

    async def to_list(self, limit):
        # Explicit yield-point so the function is genuinely async.
        await asyncio.sleep(0)
        return self.items[:limit]


class _UpdateResult:
    def __init__(self, modified_count=0, deleted_count=0):
        self.modified_count = modified_count
        self.deleted_count = deleted_count


class FakeQueue:
    """In-memory stand-in for ``db.notification_queue``."""

    def __init__(self, rows):
        self.rows = list(rows)

    def find(self, query, projection=None):
        # For this test, the query always matches — yield all rows.
        return _Cursor(list(self.rows))

    async def delete_many(self, query):
        await asyncio.sleep(0)
        ids = set(query.get("id", {}).get("$in", []))
        before = len(self.rows)
        self.rows = [r for r in self.rows if r.get("id") not in ids]
        return _UpdateResult(deleted_count=before - len(self.rows))

    async def update_many(self, query, update):
        await asyncio.sleep(0)
        ids = set(query.get("id", {}).get("$in", []))
        mods = 0
        for r in self.rows:
            if r.get("id") in ids:
                r.update(update.get("$set", {}))
                mods += 1
        return _UpdateResult(modified_count=mods)


@pytest.fixture
def queue_rows():
    return [
        {"id": "r1", "principal_kind": "internal", "principal_id": "u1",
         "frequency": "daily", "channel": "email", "title": "t1", "body": "b1",
         "sent_at": None, "created_at": "2026-04-14T00:00:00+00:00"},
        {"id": "r2", "principal_kind": "internal", "principal_id": "u1",
         "frequency": "daily", "channel": "email", "title": "t2", "body": "b2",
         "sent_at": None, "created_at": "2026-04-14T00:00:00+00:00"},
        {"id": "r3", "principal_kind": "internal", "principal_id": "u2",
         "frequency": "daily", "channel": "email", "title": "t3", "body": "b3",
         "sent_at": None, "created_at": "2026-04-14T00:00:00+00:00"},
    ]


def _fake_db(rows):
    class _DB:
        notification_queue = FakeQueue(rows)
    return _DB


def _make_principal(daily_hour=8, weekly_day="mon"):
    return Principal(
        kind="internal", id="u1", email="u1@example.com", name="U1", role="admin",
        prefs={"digest": {"daily_hour": daily_hour, "weekly_day": weekly_day}},
    )


def _assert_never_called(*_args, **_kwargs):
    """Raise to fail fast if the digest worker tries to flush off-hour."""
    raise AssertionError("digest worker flushed when it should not have")


def _load_principal_at_hour(daily_hour=8, weekly_day="mon"):
    """Build an async ``load_principal`` replacement for a given schedule."""
    async def _loader(kind, pid):  # noqa: ARG001 — signature mirrors real load_principal
        await asyncio.sleep(0)
        return _make_principal(daily_hour=daily_hour, weekly_day=weekly_day)
    return _loader


@pytest.mark.asyncio
async def test_digest_does_not_flush_off_hour(monkeypatch, queue_rows):
    db = _fake_db(queue_rows)
    monkeypatch.setattr(digest_mod, "db", db)
    monkeypatch.setattr(digest_mod, "load_principal", _load_principal_at_hour(daily_hour=8))
    monkeypatch.setattr(digest_mod, "_send_digest_and_clear", _assert_never_called)

    # Override "now" to 03:00 UTC — principal wants digest at 08:00.
    monkeypatch.setattr(
        digest_mod, "_now",
        lambda: datetime(2026, 4, 14, 3, 0, tzinfo=timezone.utc),
    )
    stats = await digest_mod.process_digests()
    assert stats["flushed"] == 0
    assert stats["queued_rows"] == 3
    assert len(db.notification_queue.rows) == 3  # nothing deleted


@pytest.mark.asyncio
async def test_digest_flushes_at_configured_hour(monkeypatch, queue_rows):
    db = _fake_db(queue_rows)
    monkeypatch.setattr(digest_mod, "db", db)
    monkeypatch.setattr(digest_mod, "load_principal", _load_principal_at_hour(daily_hour=8))

    sent_calls = []

    async def fake_send_digest_email(to, name, frequency, items):
        await asyncio.sleep(0)
        sent_calls.append({"to": to, "items": items, "frequency": frequency})
        return True

    # patch the symbol inside services.email
    import services.email as email_mod
    monkeypatch.setattr(email_mod, "send_digest_email", fake_send_digest_email)

    monkeypatch.setattr(
        digest_mod, "_now",
        lambda: datetime(2026, 4, 14, 8, 30, tzinfo=timezone.utc),
    )
    stats = await digest_mod.process_digests()
    # Two groups (u1/daily with 2 rows, u2/daily with 1 row) both flush at hour 8
    assert stats["flushed"] == 2
    assert len(sent_calls) == 2
    # Rows deleted on success
    assert db.notification_queue.rows == []


@pytest.mark.asyncio
async def test_digest_failure_leaves_rows_for_retry(monkeypatch, queue_rows):
    db = _fake_db(queue_rows)
    monkeypatch.setattr(digest_mod, "db", db)
    monkeypatch.setattr(digest_mod, "load_principal", _load_principal_at_hour(daily_hour=8))

    async def fake_send_digest_email(to, name, frequency, items):  # noqa: ARG001
        await asyncio.sleep(0)
        return False  # simulate SMTP failure

    import services.email as email_mod
    monkeypatch.setattr(email_mod, "send_digest_email", fake_send_digest_email)

    monkeypatch.setattr(
        digest_mod, "_now",
        lambda: datetime(2026, 4, 14, 8, 0, tzinfo=timezone.utc),
    )
    await digest_mod.process_digests()
    # Rows preserved for next run; last_attempt_at recorded
    assert len(db.notification_queue.rows) == 3
    assert all("last_attempt_at" in r for r in db.notification_queue.rows)


@pytest.mark.asyncio
async def test_digest_weekly_only_fires_on_configured_day(monkeypatch, queue_rows):
    # Make the rows weekly
    for r in queue_rows:
        r["frequency"] = "weekly"
    db = _fake_db(queue_rows)
    monkeypatch.setattr(digest_mod, "db", db)
    monkeypatch.setattr(
        digest_mod, "load_principal",
        _load_principal_at_hour(daily_hour=8, weekly_day="fri"),
    )

    sent = []

    async def fake_send_digest_email(to, name, frequency, items):  # noqa: ARG001
        await asyncio.sleep(0)
        sent.append(frequency)
        return True

    import services.email as email_mod
    monkeypatch.setattr(email_mod, "send_digest_email", fake_send_digest_email)

    # Monday, 08:00 — should NOT flush because weekly_day=fri.
    monkeypatch.setattr(
        digest_mod, "_now",
        lambda: datetime(2026, 4, 13, 8, 0, tzinfo=timezone.utc),  # Mon
    )
    stats = await digest_mod.process_digests()
    assert stats["flushed"] == 0

    # Friday, 08:00 — should flush.
    monkeypatch.setattr(
        digest_mod, "_now",
        lambda: datetime(2026, 4, 17, 8, 0, tzinfo=timezone.utc),  # Fri
    )
    stats = await digest_mod.process_digests()
    assert stats["flushed"] == 2
