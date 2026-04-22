import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Response

from routers.auth import delete_my_account


def test_delete_my_account_blocks_when_only_other_admin_is_soft_deleted(monkeypatch):
    """A soft-deleted admin must not count toward the remaining-admin guard."""
    fake_db = MagicMock()
    fake_db.users.find_one = AsyncMock(
        return_value={
            "id": "admin-1",
            "email": "admin@example.com",
            "name": "Admin One",
            "role": "admin",
            "deleted_at": None,
        },
    )
    fake_db.users.find_one_and_update = AsyncMock(return_value={"id": "admin-1"})

    async def _count_documents(query):
        # Regression assertion: only active admins should be counted.
        assert query == {"role": "admin", "deleted_at": None}
        return 0

    fake_db.users.count_documents = AsyncMock(side_effect=_count_documents)
    fake_db.users.update_one = AsyncMock(return_value=MagicMock())

    monkeypatch.setattr("routers.auth.db", fake_db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            delete_my_account(
                user={
                    "user_id": "admin-1",
                    "email": "admin@example.com",
                    "name": "Admin One",
                    "role": "admin",
                },
                response=Response(),
            ),
        )

    assert exc_info.value.status_code == 400
    assert "only admin" in exc_info.value.detail.lower()
    fake_db.users.update_one.assert_awaited_once_with(
        {"id": "admin-1", "deleted_at": None},
        {"$set": {"role": "admin"}},
    )
