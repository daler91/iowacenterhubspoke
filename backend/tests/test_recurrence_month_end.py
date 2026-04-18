"""Tests for the preserve_day_of_month behaviour in monthly recurrence.

Without anchor_day, Jan 31 + monthly drifts to Feb 28 → Mar 28 → Apr 28,
permanently losing the "31st" intent after the first short month. The
preserve_day path anchors every occurrence to the original day, so the
series reads Jan 31, Feb 28, Mar 31, Apr 30, May 31, ...
"""

from datetime import date

from services.schedule_utils import add_months, _build_monthly_dates


def test_add_months_without_anchor_drifts_on_short_month():
    # Legacy behaviour — Jan 31 → Feb 28 (target day truncated), then
    # subsequent adds use Feb 28 as the base.
    jan31 = date(2026, 1, 31)
    feb = add_months(jan31, 1)
    assert feb == date(2026, 2, 28)

    # Stepping from feb (anchor discarded) gives mar 28, not mar 31.
    mar = add_months(feb, 1)
    assert mar == date(2026, 3, 28)


def test_add_months_with_anchor_preserves_day():
    # Anchor-aware behaviour — Jan 31 → Feb 28 (short month clamp), but
    # stepping forward from *the original* Jan 31 + 2 gives Mar 31.
    jan31 = date(2026, 1, 31)
    assert add_months(jan31, 1, anchor_day=31) == date(2026, 2, 28)
    assert add_months(jan31, 2, anchor_day=31) == date(2026, 3, 31)
    assert add_months(jan31, 3, anchor_day=31) == date(2026, 4, 30)
    assert add_months(jan31, 4, anchor_day=31) == date(2026, 5, 31)


def test_build_monthly_dates_preserve_day_default():
    # _build_monthly_dates defaults to preserve_day=True — a Jan 31 start
    # generates Jan 31, Feb 28 (clamp), Mar 31, Apr 30, May 31, Jun 30.
    dates = _build_monthly_dates(
        date(2026, 1, 31), interval=1, occurrence_limit=6, end_date=None,
    )
    assert dates == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
    ]


def test_build_monthly_dates_no_preserve_drifts():
    # Opt-out path should exhibit the legacy drift behaviour explicitly.
    dates = _build_monthly_dates(
        date(2026, 1, 31), interval=1, occurrence_limit=4,
        end_date=None, preserve_day=False,
    )
    # Jan 31 → Feb 28 → Mar 28 → Apr 28 (stuck on 28 after the first clamp)
    assert dates == [
        "2026-01-31",
        "2026-02-28",
        "2026-03-28",
        "2026-04-28",
    ]


def test_leap_year_feb_29_from_march_31():
    # On a leap year, stepping from Jan 31 + 1 lands on Feb 29.
    jan31 = date(2024, 1, 31)
    assert add_months(jan31, 1, anchor_day=31) == date(2024, 2, 29)


def test_non_monthend_day_is_unchanged():
    # A schedule anchored on the 15th shouldn't be affected by any of
    # this — every month has a 15th.
    jun15 = date(2026, 6, 15)
    for i in range(1, 7):
        result = add_months(jun15, i, anchor_day=15)
        assert result.day == 15
