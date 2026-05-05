from contextlib import asynccontextmanager


async def run_startup_sequence(*, app, client, db, logger, ensure_redis_client):
    """Execute startup hooks in explicit, idempotent order."""
    await client.admin.command("ping")
    logger.info("Connected to MongoDB")

    try:
        from startup.migrations import run_startup_migrations
    except ImportError:
        from backend.startup.migrations import run_startup_migrations
    await run_startup_migrations(db, logger)

    try:
        from migrations.runner import run_pending as run_pending_migrations
    except ImportError:
        from backend.migrations.runner import run_pending as run_pending_migrations
    try:
        await run_pending_migrations(db)
    except RuntimeError as exc:
        if "MongoDB reported OutOfDiskSpace while creating secondary indexes" not in str(exc):
            raise
        logger.warning(
            "Skipping non-critical secondary-index migration at boot due to "
            "MongoDB disk pressure; app startup will continue and migration "
            "005 can be retried after disk is increased."
        )

    try:
        from startup.indexes import ensure_indexes
    except ImportError:
        from backend.startup.indexes import ensure_indexes
    await ensure_indexes(db, logger)

    try:
        from startup.seeds import seed_bootstrap_data
    except ImportError:
        from backend.startup.seeds import seed_bootstrap_data
    await seed_bootstrap_data(db, logger)

    app.state.redis = None
    await ensure_redis_client(app)


@asynccontextmanager
async def build_lifespan(*, app, client, db, logger, ensure_redis_client, on_shutdown):
    try:
        await run_startup_sequence(
            app=app,
            client=client,
            db=db,
            logger=logger,
            ensure_redis_client=ensure_redis_client,
        )
    except Exception as e:
        logger.error("Migration runner failed; refusing to start", exc_info=e)
        raise

    yield
    await on_shutdown(app)
