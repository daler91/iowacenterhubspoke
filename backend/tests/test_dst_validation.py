"""Tests for validate_local_time_exists — the DST spring-forward guard
used by schedule create/update/relocate/series routes.

America/Chicago springs forward on the second Sunday of March (clocks
jump 02:00 → 03:00 CST → CDT). Wall-clock times 02:00–02:59 don't exist
on that day, so any schedule landing there is storing a ghost instant.
"""

import pytest

from services.schedule_utils import validate_local_time_exists


def test_regular_time_is_valid():
    # Any mundane afternoon — no DST edge.
    validate_local_time_exists("2026-04-15", "14:30")


def test_midnight_is_valid():
    validate_local_time_exists("2026-04-15", "00:00")


def test_spring_forward_hole_rejected():
    # 2026-03-08 02:30 America/Chicago is non-existent — clocks skip from
    # 01:59 CST straight to 03:00 CDT.
    with pytest.raises(ValueError, match="daylight"):
        validate_local_time_exists("2026-03-08", "02:30")


def test_spring_forward_boundary_just_before_is_valid():
    # 01:59 on spring-forward day is still in CST — valid wall clock.
    validate_local_time_exists("2026-03-08", "01:59")


def test_spring_forward_boundary_just_after_is_valid():
    # 03:00 on spring-forward day is the first CDT minute — valid.
    validate_local_time_exists("2026-03-08", "03:00")


def test_fall_back_ambiguous_time_is_accepted():
    # 2026-11-01 01:30 occurs twice (CDT then CST). We accept it — the
    # validator only rejects *non-existent* times, not ambiguous ones,
    # because ambiguous still maps to *a* real instant.
    validate_local_time_exists("2026-11-01", "01:30")


def test_malformed_input_raises():
    # Upstream pattern validators should catch this first, but if a
    # caller ever reaches the guard with garbage we raise instead of
    # silently returning — silent-return was a data-corruption vector
    # on the edit paths (bug_018).
    with pytest.raises(ValueError, match="format"):
        validate_local_time_exists("not-a-date", "10:00")
    with pytest.raises(ValueError, match="format"):
        validate_local_time_exists("2026-04-15", "notime")


def test_unknown_timezone_is_tolerated():
    # If an operator configures an invalid tz name, fall back silently
    # rather than crashing every schedule create.
    validate_local_time_exists("2026-03-08", "02:30", tz_name="Not/A_Real_Zone")
