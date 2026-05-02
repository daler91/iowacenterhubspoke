"""Unit tests for ``services.notification_events`` — the per-event helpers.

These tests verify that each ``notify_<event>`` helper:

1. Resolves the correct recipient set.
2. Constructs a :class:`NotificationEvent` with the right ``type_key``,
   ``dedup_key``, and link structure.
3. Calls ``dispatch`` once per recipient.
4. No-ops cleanly when there are no recipients.
5. Survives per-recipient dispatch failures (errors are logged, not raised).

The dispatcher itself is tested in ``test_notification_dispatch.py`` — here
we stub ``dispatch`` and assert on its call args instead of running the
full pipeline.
"""

import asyncio
import os
import sys
from dataclasses import dataclass
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

import pytest  # noqa: E402

from services import notification_events as events_mod  # noqa: E402
from services.notification_events import (  # noqa: E402
    make_event,
    notify_new_user_pending,
    notify_project_deleted,
    notify_project_document_shared,
    notify_project_message,
    notify_project_message_mentions,
    notify_project_phase_advanced,
    notify_role_changed,
    notify_schedule_assigned,
    notify_schedule_bulk_location_changed,
    notify_schedule_bulk_status_changed,
    notify_schedule_changed,
    notify_task_assigned,
    notify_task_comment,
    notify_task_comment_mentions,
    notify_task_completed,
    notify_task_deleted,
    _fan_out,
)
from services.notification_prefs import Principal  # noqa: E402
from services.notifications import NotificationEvent  # noqa: E402, F401

# Field-name constant — the notify_task_assigned helpers read this
# off the task doc to build the dedup key. Extracted so the literal
# appears once per file (python:S1192 duplicated-string-literal).
_REV_FIELD = "assigned_rev"


# ── Helpers ──────────────────────────────────────────────────────────

def _internal(pid="u1", email="u@example.com", name="User"):
    return Principal(
        kind="internal", id=pid, email=email, name=name, role="admin",
        prefs={},
    )


def _partner(pid="c1", email="c@partner.com", name="Contact"):
    return Principal(
        kind="partner", id=pid, email=email, name=name, role=None,
        prefs={},
    )


@dataclass
class _DispatchResult:
    in_app: str = "sent"
    email: str = "sent"


class _AsyncListCursor:
    """Minimal stand-in for a motor cursor with ``.to_list``."""

    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, length=None):
        await asyncio.sleep(0)
        return list(self._docs)


class _FakeComments:
    """Minimal stand-in for ``db.task_comments``."""

    def __init__(self, docs):
        self._docs = docs

    def find(self, query, projection=None):
        # Supports both $ne (legacy) and $nin (batch exclusion) sender_id filters.
        filtered = list(self._docs)
        sender_filter = query.get("sender_id", {})
        if isinstance(sender_filter, dict):
            if "$ne" in sender_filter:
                excl = sender_filter["$ne"]
                filtered = [d for d in filtered if d.get("sender_id") != excl]
            if "$nin" in sender_filter:
                excl_set = set(sender_filter["$nin"])
                filtered = [d for d in filtered if d.get("sender_id") not in excl_set]
        return _AsyncListCursor(filtered)


class _FakePrincipalColl:
    """Stand-in for ``db.users`` / ``db.partner_contacts`` with batch + single-doc lookups."""

    def __init__(self, docs):
        self._docs = docs

    def _matches(self, doc, query):
        for k, v in query.items():
            if isinstance(v, dict) and "$in" in v:
                if doc.get(k) not in v["$in"]:
                    return False
            elif doc.get(k) != v:
                return False
        return True

    def find(self, query, projection=None):
        return _AsyncListCursor([d for d in self._docs if self._matches(d, query)])

    async def find_one(self, query, projection=None):
        await asyncio.sleep(0)
        for d in self._docs:
            if self._matches(d, query):
                return d
        return None


@pytest.fixture
def capture_dispatch(monkeypatch):
    """Replace dispatch() with a call-capturing stub."""
    calls: list[tuple[Principal, "NotificationEvent"]] = []

    async def fake_dispatch(principal, event):
        await asyncio.sleep(0)
        calls.append((principal, event))
        return _DispatchResult()

    monkeypatch.setattr(events_mod, "dispatch", fake_dispatch)
    return calls


@pytest.fixture
def stub_recipient_helpers(monkeypatch):
    """Replace the recipient-lookup helpers with configurable fakes.

    Returns a dict of lists / dicts that tests can populate before
    invoking a helper.
    """
    state = {
        "admins": [],
        "by_email": {},            # email → Principal
        "by_employee": {},         # emp_id → Principal
        "project_principals": [],  # returned by principals_for_project
        "by_id": {},               # (kind, id) → Principal
    }

    async def fake_list_admin_principals():
        await asyncio.sleep(0)
        return list(state["admins"])

    async def fake_find_principal_by_email(email):
        await asyncio.sleep(0)
        return state["by_email"].get(email)

    async def fake_principal_for_employee(emp_id):
        await asyncio.sleep(0)
        return state["by_employee"].get(emp_id)

    async def fake_principals_for_project(project_id, exclude_ids=None, *, partner_org_id=None):
        await asyncio.sleep(0)
        exclude = exclude_ids or set()
        # Ignore partner_org_id in the fake — the state["project_principals"]
        # list represents "whichever recipients this test wants to see",
        # regardless of how the helper would resolve them in production.
        _ = partner_org_id
        return [p for p in state["project_principals"] if p.id not in exclude]

    async def fake_load_principal(kind, pid):
        await asyncio.sleep(0)
        return state["by_id"].get((kind, pid))

    monkeypatch.setattr(events_mod, "list_admin_principals", fake_list_admin_principals)
    monkeypatch.setattr(events_mod, "find_principal_by_email", fake_find_principal_by_email)
    monkeypatch.setattr(events_mod, "principal_for_employee", fake_principal_for_employee)
    monkeypatch.setattr(events_mod, "principals_for_project", fake_principals_for_project)
    monkeypatch.setattr(events_mod, "load_principal", fake_load_principal)
    return state


@pytest.fixture
def stub_app_url(monkeypatch):
    """Freeze the app URL so links are predictable."""
    monkeypatch.setattr(
        events_mod, "resolve_app_url", lambda: "https://hub.test",
    )


# ── make_event: the shared builder ───────────────────────────────────

def test_make_event_sets_sensible_defaults():
    event = make_event(
        type_key="task.completed",
        title="T",
        body="B",
        link="https://hub.test/x",
        entity_type="task",
        entity_id="task-1",
        dedup_key="task-1:completed",
    )
    assert event.type_key == "task.completed"
    assert event.severity == "info"  # default
    assert event.context == {}  # default
    # default HTML wraps body + appends an "Open" link
    assert "<p>B</p>" in event.email_body_html
    assert 'href="https://hub.test/x"' in event.email_body_html
    assert ">Open</a>" in event.email_body_html


def test_make_event_custom_html_overrides_default():
    event = make_event(
        type_key="task.completed", title="T", body="B",
        email_body_html="<strong>custom</strong>",
        dedup_key="k",
    )
    assert event.email_body_html == "<strong>custom</strong>"


def test_make_event_severity_override():
    event = make_event(
        type_key="schedule.changed", title="T", body="B", severity="warning",
        dedup_key="k",
    )
    assert event.severity == "warning"


# ── notify_task_assigned ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_task_assigned_dispatches_to_email_principal(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane", "jane@x.com", "Jane")

    task = {
        "id": "t-1", "title": "Draft", "assignee_email": "jane@x.com",
        _REV_FIELD: 1,
    }
    project = {"id": "p-1", "title": "Kickoff"}
    actor = {"id": "u-bob", "name": "Bob"}

    await notify_task_assigned(task, project, actor)

    assert len(capture_dispatch) == 1
    principal, event = capture_dispatch[0]
    assert principal.id == "u-jane"
    assert event.type_key == "task.assigned_to_you"
    assert event.entity_type == "task"
    assert event.entity_id == "t-1"
    # Dedup key pins to the task's assigned_rev — a monotonic counter
    # bumped atomically by the update router's CAS. Successive
    # reassignments get distinct keys; concurrent duplicate writes all
    # read/write the same rev so only the CAS winner fires.
    assert event.dedup_key == "t-1:assigned:u-jane:rev1"
    assert "Bob" in event.title
    assert "Draft" in event.title
    assert event.link == "https://hub.test/coordination/projects/p-1"


@pytest.mark.asyncio
async def test_task_assigned_dedup_key_distinguishes_successive_edits(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    """Unassign → reassign back to same user should produce distinct keys."""
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane")
    project = {"id": "p-1", "title": "Kickoff"}
    actor = {"id": "u-bob", "name": "Bob"}

    # Two separate assignment transitions — rev bumps each time.
    first = {
        "id": "t-1", "title": "Draft", "assignee_email": "jane@x.com",
        _REV_FIELD: 1,
    }
    second = {
        "id": "t-1", "title": "Draft", "assignee_email": "jane@x.com",
        _REV_FIELD: 3,  # skipped rev 2 (unassigned in between)
    }

    await notify_task_assigned(first, project, actor)
    await notify_task_assigned(second, project, actor)

    assert len(capture_dispatch) == 2
    _, ev1 = capture_dispatch[0]
    _, ev2 = capture_dispatch[1]
    assert ev1.dedup_key == "t-1:assigned:u-jane:rev1"
    assert ev2.dedup_key == "t-1:assigned:u-jane:rev3"


@pytest.mark.asyncio
async def test_task_assigned_dedup_key_matches_on_same_rev(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    """Two dispatches at the same rev share a dedup key.

    This is the concurrency-protection property: if two call sites fire
    notify_task_assigned for the logically-same transition (same rev),
    the dispatcher's ``notifications_sent`` unique index collapses the
    second to a no-op. Here we assert the keys collide; the dispatcher
    itself is tested in ``test_notification_dispatch.py``.
    """
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane")
    task = {
        "id": "t-1", "title": "Draft", "assignee_email": "jane@x.com",
        _REV_FIELD: 5,
    }

    await notify_task_assigned(task, {"id": "p-1"}, {"id": "a", "name": "A"})
    await notify_task_assigned(task, {"id": "p-1"}, {"id": "a", "name": "A"})

    # Dispatch stub is dumb (doesn't apply the unique-index dedup), so
    # it records both calls — but their dedup keys must be identical so
    # the real dispatcher would suppress the second.
    assert len(capture_dispatch) == 2
    _, ev1 = capture_dispatch[0]
    _, ev2 = capture_dispatch[1]
    assert ev1.dedup_key == ev2.dedup_key == "t-1:assigned:u-jane:rev5"


@pytest.mark.asyncio
async def test_task_assigned_dedup_key_handles_missing_rev(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    """Legacy task rows without ``assigned_rev`` fall back to rev0."""
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane")

    task = {"id": "t-1", "title": "Draft", "assignee_email": "jane@x.com"}
    await notify_task_assigned(task, {"id": "p-1"}, {"id": "a", "name": "A"})

    _, ev = capture_dispatch[0]
    assert ev.dedup_key == "t-1:assigned:u-jane:rev0"


@pytest.mark.asyncio
async def test_task_assigned_partner_gets_no_internal_link(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    """Partner recipients must not be sent to /coordination/*.

    The coordination tree lives behind the internal auth guard; partners
    authenticate via /portal/:token. Leaking an internal URL as the CTA
    would send them to a page they cannot access.
    """
    class _DB:
        partner_contacts = _FakePrincipalColl([
            {"id": "c-jane", "partner_org_id": "org-1", "name": "Jane Smith",
             "email": "jane@p.com", "deleted_at": None},
        ])
        users = _FakePrincipalColl([])

    monkeypatch.setattr(events_mod, "db", _DB)

    task = {
        "id": "t-1", "title": "Draft", "assigned_to": "Jane Smith",
        _REV_FIELD: 1,
    }
    project = {"id": "p-1", "title": "Kickoff", "partner_org_id": "org-1"}
    await notify_task_assigned(task, project, {"id": "a", "name": "A"})

    assert len(capture_dispatch) == 1
    principal, event = capture_dispatch[0]
    assert principal.kind == "partner"
    assert event.link is None
    # Email body stays informative but the internal "Open project" CTA
    # is suppressed.
    assert "/coordination/" not in (event.email_body_html or "")
    assert "Open project" not in (event.email_body_html or "")
    assert "Draft" in (event.email_body_html or "")


@pytest.mark.asyncio
async def test_task_assigned_rejects_ambiguous_internal_name(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    """Two internal users sharing a display name must not auto-match.

    Without this guard ``find_one({'name': ...})`` returns an arbitrary
    row and the task-assignment context ships to the wrong inbox.
    """
    class _DB:
        partner_contacts = _FakePrincipalColl([])
        users = _FakePrincipalColl([
            {"id": "u-jane-a", "name": "Jane Smith",
             "email": "jane.a@x.com"},
            {"id": "u-jane-b", "name": "Jane Smith",
             "email": "jane.b@x.com"},
        ])

    monkeypatch.setattr(events_mod, "db", _DB)

    task = {"id": "t-1", "title": "Draft", "assigned_to": "Jane Smith"}
    await notify_task_assigned(
        task, {"id": "p-1"}, {"id": "a", "name": "A"},
    )
    assert capture_dispatch == []


@pytest.mark.asyncio
async def test_task_assigned_falls_back_to_assigned_to_if_it_looks_like_email(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane")
    task = {"id": "t-1", "title": "Draft", "assigned_to": "jane@x.com"}

    await notify_task_assigned(task, {"id": "p-1"}, {"id": "a", "name": "A"})
    assert len(capture_dispatch) == 1


@pytest.mark.asyncio
async def test_task_assigned_noop_when_name_unknown(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    # assigned_to is a name that isn't in the partner/user directories.

    class _DB:
        partner_contacts = _FakePrincipalColl([])
        users = _FakePrincipalColl([])

    monkeypatch.setattr(events_mod, "db", _DB)

    task = {"id": "t-1", "title": "Draft", "assigned_to": "Jane Smith"}
    await notify_task_assigned(
        task, {"id": "p-1", "partner_org_id": "org-1"}, {"id": "a", "name": "A"},
    )
    assert capture_dispatch == []


@pytest.mark.asyncio
async def test_task_assigned_resolves_name_against_partner_org(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    # A name-based assigned_to resolves against the project's partner org.

    class _DB:
        partner_contacts = _FakePrincipalColl([
            {"id": "c-jane", "partner_org_id": "org-1", "name": "Jane Smith",
             "email": "jane@p.com", "deleted_at": None},
        ])
        users = _FakePrincipalColl([])

    monkeypatch.setattr(events_mod, "db", _DB)

    task = {"id": "t-1", "title": "Draft", "assigned_to": "Jane Smith"}
    project = {"id": "p-1", "title": "Kickoff", "partner_org_id": "org-1"}
    await notify_task_assigned(task, project, {"id": "a", "name": "A"})

    assert len(capture_dispatch) == 1
    principal, _ = capture_dispatch[0]
    assert principal.id == "c-jane"
    assert principal.kind == "partner"


@pytest.mark.asyncio
async def test_task_assigned_noop_when_email_not_a_principal(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    # Email provided but not in our fake directory
    task = {"id": "t-1", "title": "Draft", "assignee_email": "nobody@x.com"}
    await notify_task_assigned(task, {"id": "p-1"}, {"id": "a", "name": "A"})
    assert capture_dispatch == []


# ── notify_task_completed ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_task_completed_fans_out_to_project_members_minus_actor(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [
        _internal("u-alice"), _partner("c-bob"),
    ]

    task = {"id": "t-1", "title": "Draft"}
    project = {"id": "p-1", "title": "Kickoff"}
    actor = {"id": "u-actor", "name": "Actor"}  # not in project list

    await notify_task_completed(task, project, actor)

    assert len(capture_dispatch) == 2
    recipient_ids = {p.id for p, _ in capture_dispatch}
    assert recipient_ids == {"u-alice", "c-bob"}
    _, ev = capture_dispatch[0]
    assert ev.type_key == "task.completed"
    assert ev.dedup_key == "t-1:completed"


@pytest.mark.asyncio
async def test_task_completed_noop_with_no_recipients(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = []
    await notify_task_completed(
        {"id": "t-1", "title": "T"}, {"id": "p-1"}, {"id": "a"},
    )
    assert capture_dispatch == []


# ── notify_task_comment ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_task_comment_notifies_assignee_and_prior_commenters(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    # Assignee
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane", "jane@x.com")

    # Stub every collection the helper touches. Commenter resolution is
    # now batched (one find() per kind), so we stub both principal tables.
    fake_comments = _FakeComments([
        {"sender_id": "u-pete", "sender_type": "internal"},
        {"sender_id": "c-liz", "sender_type": "partner"},
        {"sender_id": "u-actor", "sender_type": "internal"},  # excluded by query
    ])
    fake_users = _FakePrincipalColl([
        {"id": "u-pete", "email": "pete@x.com", "name": "Pete", "role": "editor"},
    ])
    fake_contacts = _FakePrincipalColl([
        {"id": "c-liz", "email": "liz@p.com", "name": "Liz"},
    ])

    class _DB:
        task_comments = fake_comments
        users = fake_users
        partner_contacts = fake_contacts

    monkeypatch.setattr(events_mod, "db", _DB)

    comment = {"id": "cm-1", "body": "Nice work!"}
    task = {"id": "t-1", "title": "Draft", "assignee_email": "jane@x.com"}
    project = {"id": "p-1", "title": "Kickoff"}
    actor = {"id": "u-actor", "name": "Actor"}

    await notify_task_comment(comment, task, project, actor)

    recipient_ids = {p.id for p, _ in capture_dispatch}
    assert recipient_ids == {"u-jane", "u-pete", "c-liz"}
    _, ev = capture_dispatch[0]
    assert ev.type_key == "task.comment_added"
    assert ev.dedup_key == "cm-1"


@pytest.mark.asyncio
async def test_task_comment_truncates_long_body_in_preview(
    capture_dispatch, stub_recipient_helpers, stub_app_url, monkeypatch,
):
    stub_recipient_helpers["by_email"]["j@x.com"] = _internal("u-j", "j@x.com")

    class _DB:
        task_comments = _FakeComments([])
        users = _FakePrincipalColl([])
        partner_contacts = _FakePrincipalColl([])

    monkeypatch.setattr(events_mod, "db", _DB)

    long_body = "x" * 500
    await notify_task_comment(
        {"id": "c-1", "body": long_body},
        {"id": "t-1", "assignee_email": "j@x.com"},
        {"id": "p-1"},
        {"id": "a", "name": "A"},
    )
    _, ev = capture_dispatch[0]
    assert "…" in ev.body  # truncation marker present
    assert len(ev.body) < len(long_body) + 50  # roughly bounded


@pytest.mark.asyncio
async def test_task_comment_mentions_return_delivery_count(
    capture_dispatch, stub_app_url,
):
    delivered = await notify_task_comment_mentions(
        {"id": "c-1", "body": "Please check this"},
        {"id": "t-1", "title": "Draft"},
        {"id": "p-1", "title": "Kickoff"},
        {"id": "u-actor", "name": "Actor"},
        [_internal("u-jane"), _partner("c-liz")],
    )

    assert delivered == 2
    assert len(capture_dispatch) == 2
    _, ev = capture_dispatch[0]
    assert ev.type_key == "task.comment_mentioned"
    assert ev.dedup_key == "c-1:mention"


# ── notify_project_phase_advanced ────────────────────────────────────

@pytest.mark.asyncio
async def test_phase_advanced_dispatches_with_new_phase_dedup_key(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [_internal("u-a"), _partner("c-b")]

    await notify_project_phase_advanced(
        {"id": "p-1", "title": "Launch"},
        old_phase="planning",
        new_phase="promotion",
        actor={"id": "u-x", "name": "X"},
    )
    assert len(capture_dispatch) == 2
    _, ev = capture_dispatch[0]
    assert ev.type_key == "project.phase_advanced"
    assert ev.dedup_key == "p-1:phase:promotion"
    assert "promotion" in ev.title


# ── notify_project_message ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_project_message_respects_internal_visibility(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [
        _internal("u-a"), _partner("c-b"),
    ]

    message = {
        "id": "m-1", "body": "hi", "channel": "general",
        "visibility": "internal",
    }
    await notify_project_message(
        message, {"id": "p-1", "title": "Proj"}, {"id": "u-x", "name": "X"},
    )

    # Only internal principals should be notified
    kinds = {p.kind for p, _ in capture_dispatch}
    assert kinds == {"internal"}


@pytest.mark.asyncio
async def test_project_message_shared_visibility_includes_partners(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [
        _internal("u-a"), _partner("c-b"),
    ]

    message = {
        "id": "m-1", "body": "hi", "channel": "general",
        "visibility": "shared",
    }
    await notify_project_message(
        message, {"id": "p-1", "title": "Proj"}, {"id": "u-x", "name": "X"},
    )

    kinds = {p.kind for p, _ in capture_dispatch}
    assert kinds == {"internal", "partner"}


@pytest.mark.asyncio
async def test_project_message_mentions_return_delivery_count(
    capture_dispatch, stub_app_url,
):
    delivered = await notify_project_message_mentions(
        {
            "id": "m-1",
            "body": "Hi @[Jane](user:u-jane:internal)",
            "channel": "general",
            "visibility": "shared",
        },
        {"id": "p-1", "title": "Proj"},
        {"id": "u-actor", "name": "Actor"},
        [_internal("u-jane"), _partner("c-liz")],
    )

    assert delivered == 2
    assert len(capture_dispatch) == 2
    _, ev = capture_dispatch[0]
    assert ev.type_key == "project.message_mentioned"
    assert ev.dedup_key == "m-1:mention"


# ── notify_project_document_shared ───────────────────────────────────

@pytest.mark.asyncio
async def test_document_shared_noop_when_visibility_internal(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [_internal("u-a")]
    doc = {"id": "d-1", "filename": "report.pdf", "visibility": "internal"}
    await notify_project_document_shared(doc, {"id": "p-1"}, {"id": "a"})
    assert capture_dispatch == []


@pytest.mark.asyncio
async def test_document_shared_dispatches_when_shared(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [_internal("u-a")]
    doc = {"id": "d-1", "filename": "report.pdf", "visibility": "shared"}
    await notify_project_document_shared(
        doc, {"id": "p-1", "title": "P"}, {"id": "a", "name": "A"},
    )
    assert len(capture_dispatch) == 1
    _, ev = capture_dispatch[0]
    assert ev.type_key == "project.document_shared"
    assert ev.dedup_key == "d-1"


# ── notify_schedule_assigned ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_schedule_assigned_skips_employees_without_linked_user(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    # Only one of the two employees has a linked user.
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    # emp-2 returns None (no linked user)

    schedule = {
        "id": "s-1", "location_name": "Story City", "date": "2026-05-01",
        "start_time": "09:00",
    }
    await notify_schedule_assigned(
        schedule, ["emp-1", "emp-2"], {"id": "u-x", "name": "X"},
    )

    assert len(capture_dispatch) == 1
    _, ev = capture_dispatch[0]
    assert ev.dedup_key == "s-1:assigned:emp-1"


@pytest.mark.asyncio
async def test_schedule_assigned_empty_ids_is_noop(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    await notify_schedule_assigned({"id": "s-1"}, [], {"id": "x"})
    assert capture_dispatch == []


# ── notify_schedule_changed ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_schedule_changed_uses_warning_severity_and_verb(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    schedule = {
        "id": "s-1", "employee_ids": ["emp-1"],
        "location_name": "Story City", "date": "2026-05-01",
    }
    await notify_schedule_changed(
        schedule, "cancelled", {"id": "u-x", "name": "X"},
    )
    assert len(capture_dispatch) == 1
    _, ev = capture_dispatch[0]
    assert ev.severity == "warning"
    assert "Cancelled" in ev.title or "cancelled" in ev.body.lower()
    # Dedup key includes the schedule date so repeat cancellations on
    # later dates still fire (see Codex P2 r...736 regression test).
    assert ev.dedup_key == "s-1:cancelled:2026-05-01"


@pytest.mark.asyncio
async def test_schedule_changed_relocated_uses_new_date_from_extra(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    schedule = {
        "id": "s-1", "employee_ids": ["emp-1"],
        "location_name": "L", "date": "2026-01-01",
    }
    await notify_schedule_changed(
        schedule, "relocated", {"id": "u-x", "name": "X"},
        extra={"new_date": "2026-02-15"},
    )
    _, ev = capture_dispatch[0]
    assert "2026-02-15" in ev.body
    # Dedup key incorporates the new_date so a second relocation to a
    # different date isn't silently suppressed.
    assert ev.dedup_key == "s-1:relocated:2026-02-15"


@pytest.mark.asyncio
async def test_schedule_changed_two_relocations_not_deduped(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    """Relocating the same schedule to two different dates must fire twice."""
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    schedule = {
        "id": "s-1", "employee_ids": ["emp-1"],
        "location_name": "L", "date": "2026-01-01",
    }
    actor = {"id": "u-x", "name": "X"}
    await notify_schedule_changed(schedule, "relocated", actor,
                                  extra={"new_date": "2026-02-15"})
    await notify_schedule_changed(schedule, "relocated", actor,
                                  extra={"new_date": "2026-03-20"})
    keys = {ev.dedup_key for _, ev in capture_dispatch}
    assert keys == {"s-1:relocated:2026-02-15", "s-1:relocated:2026-03-20"}


# ── notify_role_changed ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_role_changed_noop_when_role_unchanged(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_id"][("internal", "u-1")] = _internal("u-1")
    await notify_role_changed("u-1", "admin", "admin", {"id": "u-x", "name": "X"})
    assert capture_dispatch == []


@pytest.mark.asyncio
async def test_role_changed_dispatches_to_affected_user(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_id"][("internal", "u-1")] = _internal("u-1")
    await notify_role_changed("u-1", "viewer", "editor", {"id": "u-x", "name": "X"})
    assert len(capture_dispatch) == 1
    principal, ev = capture_dispatch[0]
    assert principal.id == "u-1"
    assert ev.type_key == "account.role_changed"
    assert ev.dedup_key == "u-1:role:editor"


# ── notify_new_user_pending ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_new_user_pending_fans_out_to_all_admins(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["admins"] = [_internal("u-a1"), _internal("u-a2")]
    pending = {"id": "u-new", "name": "New User", "email": "new@x.com"}

    await notify_new_user_pending(pending)

    assert len(capture_dispatch) == 2
    _, ev = capture_dispatch[0]
    assert ev.type_key == "admin.new_user_pending"
    assert ev.dedup_key == "u-new:new_user"
    assert "new@x.com" in ev.body


@pytest.mark.asyncio
async def test_new_user_pending_noop_with_no_admins(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["admins"] = []
    await notify_new_user_pending({"id": "u", "name": "N", "email": "e@x.com"})
    assert capture_dispatch == []


# ── notify_task_deleted ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_task_deleted_notifies_assignee_plus_project(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_email"]["jane@x.com"] = _internal("u-jane", "jane@x.com")
    stub_recipient_helpers["project_principals"] = [_internal("u-alice")]

    task = {"id": "t-1", "title": "Draft", "assignee_email": "jane@x.com"}
    project = {"id": "p-1", "title": "Kickoff"}
    actor = {"id": "u-actor", "name": "Actor"}

    await notify_task_deleted(task, project, actor)

    ids = {p.id for p, _ in capture_dispatch}
    # Assignee + project member, actor excluded
    assert ids == {"u-jane", "u-alice"}
    _, ev = capture_dispatch[0]
    assert ev.type_key == "task.deleted"
    assert ev.severity == "warning"
    assert ev.dedup_key == "t-1:deleted"


# ── notify_project_deleted ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_project_deleted_notifies_all_stakeholders(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["project_principals"] = [
        _internal("u-a"), _partner("c-b"),
    ]
    project = {"id": "p-1", "title": "Launch"}
    actor = {"id": "u-x", "name": "X"}
    await notify_project_deleted(project, actor)

    assert len(capture_dispatch) == 2
    _, ev = capture_dispatch[0]
    assert ev.type_key == "project.deleted"
    assert ev.severity == "warning"
    assert ev.dedup_key == "p-1:deleted"


# ── notify_schedule_bulk_status_changed ──────────────────────────────

@pytest.mark.asyncio
async def test_schedule_bulk_status_dispatches_per_assigned_employee(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    schedule = {
        "id": "s-1", "employee_ids": ["emp-1"],
        "location_name": "L", "date": "2026-05-01",
    }
    await notify_schedule_bulk_status_changed(
        schedule, "completed", {"id": "u-x", "name": "X"},
    )
    assert len(capture_dispatch) == 1
    _, ev = capture_dispatch[0]
    assert ev.type_key == "schedule.bulk_status_changed"
    assert ev.dedup_key == "s-1:status:completed"


# ── notify_schedule_bulk_location_changed ────────────────────────────

@pytest.mark.asyncio
async def test_schedule_bulk_location_uses_warning_severity(
    capture_dispatch, stub_recipient_helpers, stub_app_url,
):
    stub_recipient_helpers["by_employee"]["emp-1"] = _internal("u-1")
    schedule = {
        "id": "s-1", "employee_ids": ["emp-1"],
        "location_name": "Old Town", "date": "2026-05-01",
    }
    await notify_schedule_bulk_location_changed(
        schedule, "New Town", {"id": "u-x", "name": "X"},
    )
    assert len(capture_dispatch) == 1
    _, ev = capture_dispatch[0]
    assert ev.severity == "warning"
    assert "New Town" in ev.body
    assert ev.dedup_key == "s-1:location:New Town"


# ── Error containment ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dispatch_failure_is_logged_not_raised(
    stub_recipient_helpers, stub_app_url, monkeypatch,
):
    """A per-recipient dispatch error must not propagate to the router."""
    stub_recipient_helpers["project_principals"] = [_internal("u-a")]

    async def explode(principal, event):
        await asyncio.sleep(0)
        raise RuntimeError("SMTP down")

    monkeypatch.setattr(events_mod, "dispatch", explode)

    # Should complete without raising
    await notify_project_phase_advanced(
        {"id": "p-1", "title": "P"},
        old_phase="a", new_phase="b",
        actor={"id": "x", "name": "X"},
    )


@pytest.mark.asyncio
async def test_fan_out_aggregates_mixed_delivery_statuses(monkeypatch, caplog):
    principals = [_internal("u-1"), _internal("u-2"), _internal("u-3"), _internal("u-4")]
    results = iter([
        _DispatchResult(in_app="sent", email="skipped"),
        _DispatchResult(in_app="deduped", email="sent"),
        _DispatchResult(in_app="skipped", email="queued"),
        _DispatchResult(in_app="deduped", email="deduped"),
    ])

    async def fake_dispatch(principal, event):
        await asyncio.sleep(0)
        return next(results)

    monkeypatch.setattr(events_mod, "dispatch", fake_dispatch)

    with caplog.at_level("INFO"):
        sent = await _fan_out(principals, make_event(type_key="task.completed", title="T", body="B"), log_key="mixed")

    assert sent == 3
    assert "delivered=3" in caplog.text
    assert "in_app_sent=1" in caplog.text
    assert "email_sent=1" in caplog.text
    assert "email_queued=1" in caplog.text
    assert "skipped=2" in caplog.text
    assert "deduped=2" in caplog.text
    assert "failed=0" in caplog.text


@pytest.mark.asyncio
async def test_fan_out_increments_failed_and_continues(monkeypatch, caplog):
    principals = [_internal("u-1"), _internal("u-2"), _internal("u-3")]

    async def flaky_dispatch(principal, event):
        await asyncio.sleep(0)
        if principal.id == "u-2":
            raise RuntimeError("boom")
        return _DispatchResult(in_app="sent", email="skipped")

    monkeypatch.setattr(events_mod, "dispatch", flaky_dispatch)

    with caplog.at_level("INFO"):
        sent = await _fan_out(principals, make_event(type_key="task.completed", title="T", body="B"), log_key="flaky")

    assert sent == 2
    assert "failed=1" in caplog.text
    assert "delivered=2" in caplog.text
