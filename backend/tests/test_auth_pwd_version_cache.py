import asyncio

from core import auth as core_auth


class _FakeUsers:
    def __init__(self, row):
        self.row = row

    async def find_one(self, *_args, **_kwargs):
        return self.row


class _FakeDB:
    def __init__(self, row):
        self.users = _FakeUsers(row)


class _FakeRedis:
    def __init__(self):
        self.values = {}

    async def get(self, key):
        return self.values.get(key)

    async def set(self, key, value, ex=None):
        self.values[key] = value

    async def delete(self, key):
        self.values.pop(key, None)


def test_pwd_version_blocks_stale_tokens(monkeypatch):
    fake_db = _FakeDB({"id": "u1", "pwd_version": 3, "deleted_at": None})
    fake_redis = _FakeRedis()
    monkeypatch.setattr("database.db", fake_db)
    async def _pool():
        return fake_redis
    monkeypatch.setattr("core.queue.get_redis_pool", _pool)

    core_auth._pwd_change_cache.clear()
    version, deleted = asyncio.run(core_auth._get_pwd_version("u1"))
    assert version == 3
    assert deleted is False


def test_invalidate_broadcasts_version_to_other_worker_cache(monkeypatch):
    worker_a_db = _FakeDB({"id": "u1", "pwd_version": 1, "deleted_at": None})
    worker_b_db = _FakeDB({"id": "u1", "pwd_version": 1, "deleted_at": None})
    fake_redis = _FakeRedis()

    async def _pool():
        return fake_redis
    monkeypatch.setattr("core.queue.get_redis_pool", _pool)

    core_auth._pwd_change_cache.clear()
    monkeypatch.setattr("database.db", worker_a_db)
    assert asyncio.run(core_auth._get_pwd_version("u1")) == (1, False)

    core_auth._pwd_change_cache.clear()
    monkeypatch.setattr("database.db", worker_b_db)
    assert asyncio.run(core_auth._get_pwd_version("u1")) == (1, False)

    asyncio.run(core_auth.invalidate_pwd_cache("u1", pwd_version=2))

    core_auth._pwd_change_cache.clear()
    worker_b_db.users.row["pwd_version"] = 1  # stale DB read window
    assert asyncio.run(core_auth._get_pwd_version("u1")) == (2, False)
