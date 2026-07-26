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


async def _ensure_partial_unique_token_index(collection, field: str) -> None:
    name = f"{field}_1"
    partial = {field: {_MONGO_EXISTS: True, "$type": "string"}}
    existing = (await collection.index_information()).get(name)
    if existing and (
        existing.get("unique") is not True
        or existing.get("partialFilterExpression") != partial
    ):
        await collection.drop_index(name)
    await collection.create_index(
        field,
        unique=True,
        name=name,
        partialFilterExpression=partial,
    )


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

    **Fails closed.** Every index here is a uniqueness or TTL guard that the
    application's correctness depends on — unique ``invitations.token``,
    unique ``refresh_tokens.jti``, the per-user schedule idempotency key, TTL
    expiry on reset and portal tokens. This whole body used to sit inside one
    ``except Exception: logger.warning(...)``, so a failure on the *first*
    index silently skipped every one after it and the app booted serving
    traffic with no uniqueness constraints at all. A boot-time index failure
    is an operational problem to fix, not one to serve through.
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
        # Only the digest is indexed: new rows never store a raw ``token``
        # field, and the transitional raw-token lookup has been removed.
        await _ensure_partial_unique_token_index(db.password_resets, "token_digest")
        await db.google_oauth_states.create_index("state", unique=True)
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.outlook_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.refresh_tokens.create_index("jti", unique=True)
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.login_failures.create_index("email", unique=True)
        await db.login_failures.create_index("expires_at", expireAfterSeconds=0)
        await _ensure_partial_unique_token_index(db.portal_tokens, "token_digest")
        await db.portal_tokens.create_index("expires_at", expireAfterSeconds=0)
        # Relocation slot claims are held for the duration of a single
        # request. A crash between insert and cleanup used to orphan the
        # claim forever, permanently blocking that employee/date/time slot
        # with no recovery short of a manual delete. Ten minutes is far
        # longer than any relocate takes and far shorter than a human would
        # wait before retrying.
        await db.schedule_slot_claims.create_index(
            "claimed_at", expireAfterSeconds=600,
        )
        await db.portal_activity_events.create_index(
            [("partner_org_id", 1), ("project_id", 1), ("created_at", -1)],
        )
        await db.projects.create_index([("phase", 1), ("deleted_at", 1), ("updated_at", -1)])
        logger.info("Ensured critical boot-time indexes")
    except Exception as e:
        logger.error("Failed to create critical boot-time indexes: %s", e)
        raise

    # Drift repair is best-effort: it re-runs the *secondary* index migration
    # when a sentinel is missing (e.g. after a restore from a dump that copied
    # data but not indexes). Those are read-optimizations, so a failure here
    # degrades performance rather than correctness and must not block boot.
    try:
        await _repair_secondary_index_drift(db, logger)
    except Exception as e:
        logger.warning("Secondary index drift repair failed: %s", e)
