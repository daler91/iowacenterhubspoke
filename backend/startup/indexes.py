_MONGO_EXISTS = "$exists"


async def _ensure(collection, specs):
    for spec in specs:
        if isinstance(spec, tuple):
            keys, kwargs = spec
            await collection.create_index(keys, **kwargs)
        else:
            await collection.create_index(spec)


async def ensure_indexes(db, logger):
    """Create only critical safety indexes needed before serving traffic.

    All non-critical/read-optimization indexes are migration-managed via
    ``migrations/005_manage_secondary_indexes.py`` and should be applied by
    deployment migration tooling before rolling app instances.
    """
    try:
        # Critical-at-boot: request-path safety and data-integrity guards.
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
        # Critical-at-boot: security/session/token correctness.
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("expires_at", expireAfterSeconds=0)
        await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
        await db.password_resets.create_index("token", unique=True)
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.outlook_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.refresh_tokens.create_index("jti", unique=True)
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.login_failures.create_index("email", unique=True)
        await db.login_failures.create_index("expires_at", expireAfterSeconds=0)
        await db.portal_tokens.create_index("token", unique=True)
        await db.portal_tokens.create_index("expires_at", expireAfterSeconds=0)
        logger.info("Ensured critical boot-time indexes")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")
