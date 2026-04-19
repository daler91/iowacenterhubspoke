import os
import sys
import time
from unittest.mock import MagicMock

sys.modules.setdefault("motor", MagicMock())
sys.modules.setdefault("motor.motor_asyncio", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.analytics import (
    _compute_swap_savings,
    _derive_day_schedule_cache,
    _find_swap_suggestions,
    _group_pairs_for_evaluation,
    _prune_candidates,
)


def _build_loc_map(location_count):
    return {f"loc-{i}": {"id": f"loc-{i}", "lat": 0, "lng": 0} for i in range(location_count)}


def _build_day_schedules(employee_count=40, schedules_per_employee=8, location_count=12):
    schedules = []
    idx = 0
    for emp in range(employee_count):
        for n in range(schedules_per_employee):
            loc_idx = (emp + n) % location_count
            schedules.append({
                "id": f"s-{idx}",
                "date": "2026-03-01",
                "employee_ids": [f"e-{emp}"],
                "employees": [{"id": f"e-{emp}", "name": f"Employee {emp}"}],
                "location_id": f"loc-{loc_idx}",
                "location_name": f"Location {loc_idx}",
                "drive_time_minutes": 10 + ((emp * 7 + n * 3) % 40),
            })
            idx += 1
    return schedules


def _naive_day_swap_eval(day_schedules, loc_map):
    cache, _, _ = _derive_day_schedule_cache(day_schedules)
    results = []
    for i in range(len(day_schedules)):
        for j in range(i + 1, len(day_schedules)):
            a = day_schedules[i]
            b = day_schedules[j]
            a_ids = set(a.get("employee_ids", []))
            b_ids = set(b.get("employee_ids", []))
            if a_ids & b_ids:
                continue
            if a.get("location_id") == b.get("location_id"):
                continue
            if not loc_map.get(a.get("location_id")) or not loc_map.get(b.get("location_id")):
                continue
            savings, reason = _compute_swap_savings(a, b, cache)
            if savings > 0 and reason:
                results.append((a.get("id"), b.get("id"), savings))
    return results


def _count_candidate_pairs_after_pruning(day_schedules):
    cache, _, _ = _derive_day_schedule_cache(day_schedules)
    pruned = _prune_candidates(day_schedules, cache, top_k_per_employee=6)
    grouped = _group_pairs_for_evaluation(pruned, cache, approx_mode=False)
    pairs = 0
    for i in range(len(grouped)):
        for j in range(i, len(grouped)):
            if i == j:
                g = len(grouped[i])
                pairs += g * (g - 1) // 2
            else:
                pairs += len(grouped[i]) * len(grouped[j])
    return pairs


def test_find_swap_suggestions_sets_partial_for_large_days():
    schedules = _build_day_schedules(employee_count=30, schedules_per_employee=5, location_count=10)
    loc_map = _build_loc_map(10)

    suggestions, partial = _find_swap_suggestions(schedules, loc_map)

    assert partial is True
    assert isinstance(suggestions, list)
    if suggestions:
        expected = {
            "date", "employee_a", "employee_a_id", "employee_b", "employee_b_id",
            "location_a", "location_b", "schedule_a_id", "schedule_b_id",
            "current_drive_mins", "optimized_drive_mins", "savings_mins", "reason",
        }
        assert expected.issubset(set(suggestions[0].keys()))


def test_find_swap_suggestions_not_partial_for_small_days():
    schedules = _build_day_schedules(employee_count=5, schedules_per_employee=4, location_count=7)
    loc_map = _build_loc_map(7)

    _suggestions, partial = _find_swap_suggestions(schedules, loc_map)

    assert partial is False


def test_cache_preserves_duplicate_location_presence_after_excluding_current_schedule():
    day_schedules = [
        {"id": "s1", "date": "2026-03-01", "employee_ids": ["e1"], "employees": [{"id": "e1", "name": "E1"}], "location_id": "loc-x", "location_name": "X", "drive_time_minutes": 30},
        {"id": "s2", "date": "2026-03-01", "employee_ids": ["e1"], "employees": [{"id": "e1", "name": "E1"}], "location_id": "loc-x", "location_name": "X", "drive_time_minutes": 25},
        {"id": "s3", "date": "2026-03-01", "employee_ids": ["e1"], "employees": [{"id": "e1", "name": "E1"}], "location_id": "loc-y", "location_name": "Y", "drive_time_minutes": 20},
    ]

    cache, _, _ = _derive_day_schedule_cache(day_schedules)

    # Excluding s1 should still leave loc-x because e1 has another loc-x schedule (s2).
    assert "loc-x" in cache["s1"]["other_locations"]
    assert "loc-y" in cache["s1"]["other_locations"]


def test_cache_counts_secondary_assignees_in_location_history():
    day_schedules = [
        {"id": "s1", "date": "2026-03-01", "employee_ids": ["e1", "e3"], "employees": [{"id": "e1", "name": "E1"}], "location_id": "loc-a", "location_name": "A", "drive_time_minutes": 30},
        {"id": "s2", "date": "2026-03-01", "employee_ids": ["e2", "e1"], "employees": [{"id": "e2", "name": "E2"}], "location_id": "loc-b", "location_name": "B", "drive_time_minutes": 20},
    ]

    cache, _, _ = _derive_day_schedule_cache(day_schedules)

    # e1 is secondary on s2, but should still count loc-b in e1's location history.
    assert "loc-b" in cache["s1"]["other_locations"]


def test_pruned_solver_faster_than_naive_fixture():
    schedules = _build_day_schedules(employee_count=28, schedules_per_employee=9, location_count=12)
    loc_map = _build_loc_map(12)

    start_naive = time.perf_counter()
    naive = _naive_day_swap_eval(schedules, loc_map)
    naive_elapsed = time.perf_counter() - start_naive

    start_optimized = time.perf_counter()
    optimized, _partial = _find_swap_suggestions(schedules, loc_map)
    optimized_elapsed = time.perf_counter() - start_optimized

    naive_pair_count = len(schedules) * (len(schedules) - 1) // 2
    pruned_pair_count = _count_candidate_pairs_after_pruning(schedules)

    assert pruned_pair_count < naive_pair_count
    assert optimized_elapsed <= naive_elapsed * 2.0
    assert isinstance(optimized, list)
    assert len(optimized) <= len(naive)
