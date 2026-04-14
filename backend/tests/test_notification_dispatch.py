"""Dispatcher behavior tests — channel gating, instant vs queued, dedup.

The dispatcher touches ``db.notifications`` (inbox inserts),
``db.notification_queue`` (digest enqueue), and ``db.notifications_sent``
(dedup). We replace those three collections with in-memory fakes so the
dispatcher's branching is verifiable without a live Mongo.
"""

import os
import sys
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest  # noqa: E402

from services import notifications as notif_mod  # noqa: E402
from services.notification_prefs import Principal  # noqa: E402
from services.notifications import NotificationEvent, dispatch  # noqa: E402


class FakeCollection:
    """Minimal async Mongo collection stand-in.

    Only implements the methods the dispatcher actually calls:
    ``insert_one`` / ``find_one`` / ``update_one`` / ``update_many`` /
    ``count_documents`` / ``find``.
    """

    def __init__(self):
        self.docs: list[dict] = []

    async def insert_one(self, doc):
        # Dedup unique index simulation: reject if a prior (principal_kind,
        # principal_id, type_key, channel, dedup_key) row exists.
        keys = {"principal_kind", "principal_id", "type_key", "channel", "dedup_key"}
        if keys.issubset(doc.keys()):
            for existing in self.docs:
                if all(existing.get(k) == doc[k] for k in keys):
                    raise Exception("duplicate key")
        self.docs.append(doc)
        return MagicMock(inserted_id=doc.get("id"))

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None


@pytest.fixture
def fake_db(monkeypatch):
    ncoll = FakeCollection()
    qcoll = FakeCollection()
    scoll = FakeCollection()

    class _DB:
        notifications = ncoll
        notification_queue = qcoll
        notifications_sent = scoll

    monkeypatch.setattr(notif_mod, "db", _DB)
    # Stub the instant email path so we don't reach aiosmtplib
    sent_emails: list[dict] = []

    async def fake_send_instant_email(principal, event):
        sent_emails.append({"to": principal.email, "title": event.title})
        return True

    monkeypatch.setattr(notif_mod, "_send_instant_email", fake_send_instant_email)

    return {
        "notifications": ncoll, "queue": qcoll, "sent": scoll,
        "emails": sent_emails,
    }


def _principal(prefs=None, kind="internal", email="u@example.com"):
    return Principal(
        kind=kind, id="p1", email=email, name="U", role="admin",
        prefs=prefs or {},
    )


@pytest.mark.asyncio
async def test_dispatch_instant_inserts_inbox_and_sends_email(fake_db):
    principal = _principal()
    event = NotificationEvent(
        type_key="task.approaching",  # registry: in_app=instant, email=instant
        title="Task due soon", body="body",
    )
    result = await dispatch(principal, event)
    assert result.in_app == "sent"
    assert result.email == "sent"
    assert len(fake_db["notifications"].docs) == 1
    assert fake_db["notifications"].docs[0]["type_key"] == "task.approaching"
    assert fake_db["emails"] == [{"to": "u@example.com", "title": "Task due soon"}]
    # No queue rows because freq=instant
    assert fake_db["queue"].docs == []


@pytest.mark.asyncio
async def test_dispatch_off_channel_is_skipped(fake_db):
    principal = _principal(prefs={"types": {"task.approaching": {"email": "off"}}})
    event = NotificationEvent(type_key="task.approaching", title="t", body="b")
    result = await dispatch(principal, event)
    assert result.email == "off"
    assert result.in_app == "sent"  # still in_app=instant from registry
    assert fake_db["emails"] == []


@pytest.mark.asyncio
async def test_dispatch_daily_enqueues_for_digest(fake_db):
    # task.overdue registry default is email=daily.
    principal = _principal()
    event = NotificationEvent(type_key="task.overdue", title="t", body="b")
    result = await dispatch(principal, event)
    assert result.email == "queued"
    assert len(fake_db["queue"].docs) == 1
    row = fake_db["queue"].docs[0]
    assert row["frequency"] == "daily"
    assert row["channel"] == "email"
    assert fake_db["emails"] == []  # nothing sent yet


@pytest.mark.asyncio
async def test_dispatch_weekly_enqueues(fake_db):
    principal = _principal(prefs={"types": {"task.approaching": {"email": "weekly"}}})
    event = NotificationEvent(type_key="task.approaching", title="t", body="b")
    result = await dispatch(principal, event)
    assert result.email == "queued"
    assert fake_db["queue"].docs[0]["frequency"] == "weekly"


@pytest.mark.asyncio
async def test_dispatch_dedup_prevents_duplicate(fake_db):
    principal = _principal()
    event = NotificationEvent(
        type_key="task.approaching", title="t", body="b",
        dedup_key="task-123:48h",
    )
    first = await dispatch(principal, event)
    second = await dispatch(principal, event)
    assert first.email == "sent"
    assert second.email == "deduped"
    assert second.in_app == "deduped"
    # email only sent once
    assert len(fake_db["emails"]) == 1
    # inbox only written once
    assert len(fake_db["notifications"].docs) == 1


@pytest.mark.asyncio
async def test_dispatch_without_dedup_key_does_not_dedup(fake_db):
    principal = _principal()
    event = NotificationEvent(type_key="task.approaching", title="t", body="b")
    await dispatch(principal, event)
    await dispatch(principal, event)
    # two emails, two inbox rows — no dedup when no key
    assert len(fake_db["emails"]) == 2
    assert len(fake_db["notifications"].docs) == 2


@pytest.mark.asyncio
async def test_dispatch_unknown_type_is_noop(fake_db):
    principal = _principal()
    event = NotificationEvent(type_key="totally.bogus", title="t", body="b")
    result = await dispatch(principal, event)
    assert result.in_app == "unsupported"
    assert result.email == "unsupported"
    assert fake_db["notifications"].docs == []
    assert fake_db["queue"].docs == []


@pytest.mark.asyncio
async def test_dispatch_audience_mismatch_is_off(fake_db):
    # schedule.upcoming_today is internal-only. Dispatch to a partner → off.
    partner = _principal(kind="partner", prefs={})
    event = NotificationEvent(type_key="schedule.upcoming_today", title="t", body="b")
    result = await dispatch(partner, event)
    assert result.in_app == "off"
    assert result.email == "off"


@pytest.mark.asyncio
async def test_dispatch_in_app_daily_coerced_to_instant(fake_db):
    # in_app channel doesn't do digests — a stored 'daily' override for
    # in_app should have been sanitized to 'instant'; but even if it wasn't,
    # the dispatcher degrades gracefully.
    principal = _principal(prefs={"types": {"task.approaching": {"in_app": "daily"}}})
    event = NotificationEvent(type_key="task.approaching", title="t", body="b")
    result = await dispatch(principal, event)
    # dispatcher sees "daily" for in_app and persists the inbox row anyway
    assert result.in_app == "sent"
    assert len(fake_db["notifications"].docs) == 1
