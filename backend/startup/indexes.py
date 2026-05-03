_MONGO_EXISTS = "$exists"


async def ensure_indexes(db, logger):
    """Create required database indexes."""
    try:
        await db.schedules.create_index([("employee_ids", 1), ("deleted_at", 1), ("date", 1)])
        await db.schedules.create_index([("location_id", 1), ("deleted_at", 1), ("date", 1)])
        await db.schedules.create_index([("class_id", 1), ("deleted_at", 1), ("date", 1)])
        await db.schedules.create_index([("date", 1), ("status", 1)])
        await db.schedules.create_index([("deleted_at", 1)])
        for stale_index in ("idempotency_key_1", "idempotency_key_live_unique"):
            try:
                await db.schedules.drop_index(stale_index)
            except Exception:
                pass
        await db.schedules.create_index(
            [("created_by_user_id", 1), ("idempotency_key", 1)],
            unique=True,
            partialFilterExpression={
                "idempotency_key": {_MONGO_EXISTS: True, "$type": "string"},
                "deleted_at": None,
            },
            name="idempotency_key_per_user_live_unique",
        )
        await db.employees.create_index([("id", 1), ("deleted_at", 1)])
        await db.employees.create_index([("deleted_at", 1)])
        await db.locations.create_index([("id", 1), ("deleted_at", 1)])
        await db.locations.create_index([("deleted_at", 1)])
        await db.classes.create_index([("id", 1), ("deleted_at", 1)])
        await db.classes.create_index([("deleted_at", 1)])
        await db.activity_logs.create_index([("timestamp", -1)])
        await db.activity_logs.create_index([("entity_type", 1), ("entity_id", 1)])
        await db.activity_logs.create_index("expires_at", expireAfterSeconds=0)
        await db.activity_logs.create_index([("user_id", 1)])
        await db.users.create_index([("deleted_at", 1)])
        await db.drive_time_cache.create_index("key", unique=True)
        await db.drive_time_cache.create_index("expires_at", expireAfterSeconds=0)
        logger.info("Ensured indexes on all collections")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")
