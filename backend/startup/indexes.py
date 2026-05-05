_MONGO_EXISTS = "$exists"


async def _ensure(collection, specs):
    for spec in specs:
        if isinstance(spec, tuple):
            keys, kwargs = spec
            await collection.create_index(keys, **kwargs)
        else:
            await collection.create_index(spec)


async def _has_index(collection, index_name: str) -> bool:
    indexes = await collection.index_information()
    return index_name in indexes


async def _repair_secondary_index_drift(db, logger) -> None:
    """Self-heal secondary indexes if migration state drifts from DB state.

    ``005_manage_secondary_indexes`` is tracked in ``schema_migrations`` and is
    therefore one-shot by design. In restore/drift scenarios where migration
    records are present but indexes are missing, we still need a safety net.
    We keep startup overhead low by checking a few sentinel indexes and only
    executing the full secondary-index ensure when drift is detected.
    """
    sentinels = (
        (db.schedules, "employee_ids_1_deleted_at_1_date_1"),
        (db.drive_time_cache, "key_1"),
        (db.notifications_sent, "principal_kind_1_principal_id_1_type_key_1_channel_1_dedup_key_1"),
    )
    for collection, index_name in sentinels:
        if not await _has_index(collection, index_name):
            logger.warning(
                "Detected secondary index drift (%s missing on %s); running repair ensure",
                index_name,
                collection.name,
            )
            try:
                from migrations.manage_secondary_indexes import run as run_secondary_index_ensure
            except ImportError:
                from backend.migrations.manage_secondary_indexes import run as run_secondary_index_ensure
            await run_secondary_index_ensure(db)
            logger.info("Repaired secondary indexes after drift detection")
            return


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
        await _repair_secondary_index_drift(db, logger)
        logger.info("Ensured critical boot-time indexes")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")
