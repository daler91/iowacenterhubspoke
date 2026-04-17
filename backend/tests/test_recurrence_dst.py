"""Regression tests covering recurrence math across DST transitions.

AGENT_REVIEW_REPORT.md Suggestion 6 flagged naive-datetime arithmetic as
a potential source of 1-hour shifts at US DST boundaries. The current
implementation uses pure ``datetime.date`` (no time component, no TZ),
which is immune to DST — these tests pin that behavior so a future
refactor can't quietly reintroduce the bug.
"""

from models.schemas import RecurrenceRule
from services.schedule_utils import build_recurrence_dates


def test_weekly_recurrence_spans_spring_forward_without_drift():
    # 2026-03-08 is US spring-forward. A weekly recurrence starting
    # the week before must continue landing on the same weekday
    # (Sunday) after the transition.
    rule = RecurrenceRule(
        interval=1,
        frequency="week",
        weekdays=[0],  # 0 = Sunday in the app's convention
        end_mode="after_occurrences",
        occurrences=5,
    )
    dates = build_recurrence_dates("2026-03-01", rule)
    assert dates == [
        "2026-03-01",
        "2026-03-08",  # spring-forward day
        "2026-03-15",
        "2026-03-22",
        "2026-03-29",
    ]


def test_weekly_recurrence_spans_fall_back_without_drift():
    # 2026-11-01 is US fall-back. Weekly recurrence should land on the
    # correct Sundays before and after.
    rule = RecurrenceRule(
        interval=1,
        frequency="week",
        weekdays=[0],
        end_mode="after_occurrences",
        occurrences=4,
    )
    dates = build_recurrence_dates("2026-10-25", rule)
    assert dates == [
        "2026-10-25",
        "2026-11-01",  # fall-back day
        "2026-11-08",
        "2026-11-15",
    ]


def test_monthly_recurrence_across_spring_dst():
    rule = RecurrenceRule(
        interval=1,
        frequency="month",
        end_mode="after_occurrences",
        occurrences=4,
    )
    dates = build_recurrence_dates("2026-02-15", rule)
    assert dates == [
        "2026-02-15",
        "2026-03-15",
        "2026-04-15",
        "2026-05-15",
    ]


def test_biweekly_recurrence_survives_dst():
    rule = RecurrenceRule(
        interval=2,
        frequency="week",
        weekdays=[0],
        end_mode="after_occurrences",
        occurrences=4,
    )
    dates = build_recurrence_dates("2026-03-01", rule)
    assert dates == [
        "2026-03-01",
        "2026-03-15",
        "2026-03-29",
        "2026-04-12",
    ]
