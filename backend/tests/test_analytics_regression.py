"""Tests for the pure-Python linear regression helper used by the forecast
endpoint. Replaces numpy.polyfit — we verify the helper reproduces the same
slope/intercept as the closed-form least-squares formula on known inputs.
"""
import os
import sys
from unittest.mock import MagicMock

# Stub heavy deps the production modules import, matching the pattern used
# in other unit tests in this directory.
sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.analytics import _linear_regression


def test_perfect_positive_slope():
    # y = 2x + 1 over x = 0..4 → slope 2, intercept 1
    slope, intercept = _linear_regression([1.0, 3.0, 5.0, 7.0, 9.0])
    assert abs(slope - 2.0) < 1e-9
    assert abs(intercept - 1.0) < 1e-9


def test_perfect_negative_slope():
    # y = -3x + 10 over x = 0..4 → slope -3, intercept 10
    slope, intercept = _linear_regression([10.0, 7.0, 4.0, 1.0, -2.0])
    assert abs(slope - (-3.0)) < 1e-9
    assert abs(intercept - 10.0) < 1e-9


def test_flat_series_returns_zero_slope():
    slope, intercept = _linear_regression([5.0, 5.0, 5.0, 5.0])
    assert abs(slope) < 1e-9
    assert abs(intercept - 5.0) < 1e-9


def test_noisy_series_matches_analytic_formula():
    # OLS over y=[3, 5, 4, 8, 7, 10] against x=0..5:
    #   slope     = (n*Σxy − Σx·Σy) / (n*Σx² − (Σx)²) = 135/105 = 9/7
    #   intercept = (Σy − slope·Σx) / n             = (37 − (9/7)·15) / 6 = 62/21
    y = [3.0, 5.0, 4.0, 8.0, 7.0, 10.0]
    slope, intercept = _linear_regression(y)
    assert abs(slope - 9.0 / 7.0) < 1e-9
    assert abs(intercept - 62.0 / 21.0) < 1e-9


def test_insufficient_data():
    assert _linear_regression([]) == (0.0, 0.0)
    assert _linear_regression([7.5]) == (0.0, 7.5)


def test_forecast_projection_values():
    # For historical slope=2, intercept=1 over n=5, the next week (xi=5)
    # should project to 2*5 + 1 = 11. Mirrors the call pattern in the
    # forecast endpoint.
    slope, intercept = _linear_regression([1.0, 3.0, 5.0, 7.0, 9.0])
    assert abs((slope * 5 + intercept) - 11.0) < 1e-9
