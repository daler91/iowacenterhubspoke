from unittest.mock import AsyncMock, MagicMock

import asyncio

from routers.auth import _classify_legacy_rows, export_my_data


class _FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def sort(self, key, direction):
        reverse = direction == -1
        self._rows = sorted(self._rows, key=lambda r: r.get(key, ""), reverse=reverse)
        return self

    async def to_list(self, _limit):
        await asyncio.sleep(0)
        return list(self._rows)

    def __aiter__(self):
        self._iter_idx = 0
        return self

    async def __anext__(self):
        if self._iter_idx >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._iter_idx]
        self._iter_idx += 1
        return row


class _FakeCollection:
    def __init__(self, *, find_rows=None, find_one_row=None):
        self._find_rows = find_rows or []
        self.find_one = AsyncMock(return_value=find_one_row)

    def find(self, query, projection=None):
        del projection
        rows = [r for r in self._find_rows if _matches(query, r)]
        return _FakeCursor(rows)


def _matches(query, row):
    for key, value in query.items():
        if key == "$or":
            return any(_matches(sub, row) for sub in value)
        if isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            continue
        if row.get(key) != value:
            return False
    return True


def _build_fake_db(*, users, employee, activity_logs, password_resets):
    fake = MagicMock()
    fake.users = _FakeCollection(find_rows=users, find_one_row=users[0])
    fake.employees = _FakeCollection(find_one_row=employee)
    fake.activity_logs = _FakeCollection(find_rows=activity_logs)
    fake.password_resets = _FakeCollection(find_rows=password_resets)
    return fake


def test_export_splits_confident_and_ambiguous_legacy_rows(monkeypatch):
    target_user = {
        "id": "u1",
        "email": "alex@example.com",
        "name": "Alex",
        "created_at": "2024-01-01T00:00:00+00:00",
    }
    other_user_same_name = {
        "id": "u2",
        "email": "alex2@example.com",
        "name": "Alex",
        "created_at": "2024-06-01T00:00:00+00:00",
    }
    logs = [
        {"id": "l1", "user_id": "u1", "user_name": "Alex", "timestamp": "2024-12-01T00:00:00+00:00"},
        {"id": "l2", "user_id": None, "user_name": "Alex", "timestamp": "2024-03-01T00:00:00+00:00"},
        {"id": "l3", "user_id": "", "user_name": "Alex", "timestamp": "2024-07-01T00:00:00+00:00"},
    ]

    fake_db = _build_fake_db(
        users=[target_user, other_user_same_name],
        employee=None,
        activity_logs=logs,
        password_resets=[],
    )
    monkeypatch.setattr("routers.auth.db", fake_db)

    result = asyncio.run(export_my_data({"user_id": "u1", "email": "alex@example.com", "name": "Alex"}))

    confident_ids = [r["id"] for r in result["activity_log"]["confident"]]
    ambiguous_ids = [r["id"] for r in result["activity_log"]["ambiguous"]]

    assert set(confident_ids) == {"l1", "l2"}
    assert ambiguous_ids == ["l3"]


def test_export_keeps_all_legacy_rows_ambiguous_without_creation_metadata(monkeypatch):
    target_user = {
        "id": "u1",
        "email": "sam@example.com",
        "name": "Sam",
        "created_at": "2024-01-01T00:00:00+00:00",
    }
    other_user_same_name_missing_created = {
        "id": "u2",
        "email": "sam2@example.com",
        "name": "Sam",
        # missing created_at forces strict fallback
    }
    logs = [
        {"id": "l10", "user_id": None, "user_name": "Sam", "timestamp": "2024-03-01T00:00:00+00:00"},
    ]

    fake_db = _build_fake_db(
        users=[target_user, other_user_same_name_missing_created],
        employee=None,
        activity_logs=logs,
        password_resets=[],
    )
    monkeypatch.setattr("routers.auth.db", fake_db)

    result = asyncio.run(export_my_data({"user_id": "u1", "email": "sam@example.com", "name": "Sam"}))

    assert result["activity_log"]["confident"] == []
    assert [r["id"] for r in result["activity_log"]["ambiguous"]] == ["l10"]


def test_classify_legacy_rows_single_candidate_confident_after_created():
    same_name_users = [{"id": "u1", "created_at": "2024-01-01T00:00:00+00:00"}]
    legacy_rows = [
        {"id": "l1", "timestamp": "2024-01-01T00:00:00+00:00"},
        {"id": "l2", "timestamp": "2024-02-01T00:00:00+00:00"},
    ]

    confident, ambiguous = _classify_legacy_rows(
        legacy_rows=legacy_rows,
        user_id="u1",
        same_name_users=same_name_users,
    )

    assert [r["id"] for r in confident] == ["l1", "l2"]
    assert ambiguous == []


def test_classify_legacy_rows_first_created_boundary_equal_timestamp_is_ambiguous():
    same_name_users = [
        {"id": "u1", "created_at": "2024-01-01T00:00:00+00:00"},
        {"id": "u2", "created_at": "2024-06-01T00:00:00+00:00"},
    ]
    legacy_rows = [
        {"id": "before_boundary", "timestamp": "2024-05-31T23:59:59+00:00"},
        {"id": "at_boundary", "timestamp": "2024-06-01T00:00:00+00:00"},
    ]

    confident, ambiguous = _classify_legacy_rows(
        legacy_rows=legacy_rows,
        user_id="u1",
        same_name_users=same_name_users,
    )

    assert [r["id"] for r in confident] == ["before_boundary"]
    assert [r["id"] for r in ambiguous] == ["at_boundary"]
