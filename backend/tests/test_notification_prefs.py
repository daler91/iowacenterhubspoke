"""Unit tests for the notification preference registry + resolver.

These tests exercise pure-function logic — no database, no SMTP. The
dispatcher/digest integration tests live in ``test_notification_dispatch``
and ``test_notification_digest``.
"""

import os
import sys
from unittest.mock import MagicMock

# Mirror the stub pattern used across other unit tests in this suite.
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("JWT_SECRET", "test_secret")

from core.notification_types import (  # noqa: E402
    NOTIFICATION_TYPES,
    default_frequency,
    get_type,
    is_valid_type,
    serialize_type_for_api,
    visible_types_for,
)
from services.notification_prefs import (  # noqa: E402
    DEFAULT_DIGEST,
    Principal,
    get_digest_settings,
    get_effective_prefs,
    get_frequency,
    sanitize_update,
)


# ── Registry basics ────────────────────────────────────────────────────

def test_registry_has_expected_categories():
    categories = {t["category"] for t in NOTIFICATION_TYPES.values()}
    assert {"schedules", "tasks", "projects", "account", "admin", "transactional"} <= categories


def test_transactional_types_marked_transactional():
    for key in ("transactional.password_reset", "transactional.account_approved",
                "transactional.user_invite", "transactional.portal_invite"):
        assert NOTIFICATION_TYPES[key]["transactional"] is True


def test_is_valid_type_rejects_unknown():
    assert is_valid_type("task.overdue")
    assert not is_valid_type("nope.unknown")


def test_default_frequency_for_unknown_type_is_off():
    assert default_frequency("totally.made.up", "email") == "off"
    assert default_frequency("totally.made.up", "in_app") == "off"


def test_default_frequency_respects_allowed_channels():
    # password_reset only allows email; in_app must be off.
    assert default_frequency("transactional.password_reset", "email") == "instant"
    assert default_frequency("transactional.password_reset", "in_app") == "off"


# ── Audience / role filtering ──────────────────────────────────────────

def test_visible_types_hides_transactional():
    visible = visible_types_for("internal", "admin")
    for t in visible:
        assert not t.get("transactional")


def test_visible_types_hides_admin_only_for_non_admins():
    # A viewer should not see admin.* entries.
    visible_keys = {t["key"] for t in visible_types_for("internal", "viewer")}
    assert "admin.new_user_pending" not in visible_keys
    # An admin should.
    admin_keys = {t["key"] for t in visible_types_for("internal", "admin")}
    assert "admin.new_user_pending" in admin_keys


def test_visible_types_honours_audience():
    # schedule.* is internal-only; partners should not see it.
    partner_keys = {t["key"] for t in visible_types_for("partner", None)}
    for k in partner_keys:
        assert not k.startswith("schedule.")


# ── Principal-aware get_frequency ──────────────────────────────────────

def _p(kind="internal", prefs=None, role="admin"):
    return Principal(
        kind=kind, id="p1", email="x@example.com", name="X", role=role,
        prefs=prefs or {},
    )


def test_get_frequency_defaults_when_no_overrides():
    p = _p()
    assert get_frequency(p, "task.overdue", "email") == "daily"  # registry default
    assert get_frequency(p, "task.overdue", "in_app") == "instant"


def test_get_frequency_applies_override():
    p = _p(prefs={"types": {"task.overdue": {"email": "off"}}})
    assert get_frequency(p, "task.overdue", "email") == "off"
    # other channel unchanged
    assert get_frequency(p, "task.overdue", "in_app") == "instant"


def test_get_frequency_ignores_invalid_override():
    p = _p(prefs={"types": {"task.overdue": {"email": "bogus"}}})
    # falls back to registry default
    assert get_frequency(p, "task.overdue", "email") == "daily"


def test_get_frequency_off_outside_audience():
    partner = _p(kind="partner", role=None)
    # schedule.* is internal-only
    assert get_frequency(partner, "schedule.upcoming_today", "in_app") == "off"


def test_get_frequency_off_when_role_missing():
    viewer = _p(role="viewer")
    assert get_frequency(viewer, "admin.new_user_pending", "email") == "off"


# ── sanitize_update ────────────────────────────────────────────────────

def test_sanitize_update_drops_unknown_type_keys():
    raw = {"types": {"bogus.key": {"email": "instant"}}}
    clean = sanitize_update(raw)
    assert clean["types"] == {}


def test_sanitize_update_drops_transactional_overrides():
    raw = {"types": {"transactional.password_reset": {"email": "off"}}}
    clean = sanitize_update(raw)
    # Transactional types must not be overridable — silently dropped.
    assert "transactional.password_reset" not in clean["types"]


def test_sanitize_update_drops_bad_frequency():
    raw = {"types": {"task.overdue": {"email": "someday", "in_app": "instant"}}}
    clean = sanitize_update(raw)
    assert clean["types"]["task.overdue"] == {"in_app": "instant"}


def test_sanitize_update_coerces_in_app_digest_to_instant():
    # in_app only honours instant/off; daily/weekly are coerced up to instant.
    raw = {"types": {"task.overdue": {"in_app": "daily"}}}
    clean = sanitize_update(raw)
    assert clean["types"]["task.overdue"]["in_app"] == "instant"


def test_sanitize_update_fills_digest_defaults():
    clean = sanitize_update({})
    assert clean["digest"]["daily_hour"] == DEFAULT_DIGEST["daily_hour"]
    assert clean["digest"]["weekly_day"] == DEFAULT_DIGEST["weekly_day"]


def test_sanitize_update_clamps_invalid_digest_hour():
    clean = sanitize_update({"digest": {"daily_hour": 99, "weekly_day": "funday"}})
    assert clean["digest"]["daily_hour"] == DEFAULT_DIGEST["daily_hour"]
    assert clean["digest"]["weekly_day"] == DEFAULT_DIGEST["weekly_day"]


def test_sanitize_update_accepts_valid_digest():
    clean = sanitize_update({"digest": {"daily_hour": 17, "weekly_day": "fri"}})
    assert clean["digest"]["daily_hour"] == 17
    assert clean["digest"]["weekly_day"] == "fri"


# ── Effective prefs view ───────────────────────────────────────────────

def test_get_effective_prefs_omits_transactional_and_other_audiences():
    p = _p(kind="partner", role=None)
    view = get_effective_prefs(p)
    for key in view["types"]:
        t = get_type(key)
        assert t is not None
        assert not t.get("transactional")
        assert "partner" in t["audience"]


def test_get_effective_prefs_merges_overrides():
    p = _p(prefs={"types": {"task.overdue": {"email": "off"}}})
    view = get_effective_prefs(p)
    assert view["types"]["task.overdue"]["email"] == "off"
    # other types unchanged
    assert view["types"]["task.approaching"]["email"] == "instant"


def test_get_digest_settings_returns_defaults_when_missing():
    p = _p()
    d = get_digest_settings(p)
    assert d == DEFAULT_DIGEST


# ── API serialization ──────────────────────────────────────────────────

def test_serialize_type_for_api_shape():
    t = NOTIFICATION_TYPES["task.overdue"]
    ser = serialize_type_for_api(t)
    assert ser["key"] == "task.overdue"
    assert ser["category"] == "tasks"
    assert ser["default_channels"] == {"in_app": "instant", "email": "daily"}
    assert sorted(ser["allowed_channels"]) == ["email", "in_app"]
    # sets are not JSON serialisable — make sure we got a list
    assert isinstance(ser["allowed_channels"], list)
