_MONGO_EXISTS = "$exists"


async def _ensure(collection, specs):
    for spec in specs:
        if isinstance(spec, tuple):
            keys, kwargs = spec
            await collection.create_index(keys, **kwargs)
        else:
            await collection.create_index(spec)


async def ensure_indexes(db, logger):
    """Create required database indexes."""
    try:
        await _ensure(
            db.schedules,
            [
                [("employee_ids", 1), ("deleted_at", 1), ("date", 1)],
                [("location_id", 1), ("deleted_at", 1), ("date", 1)],
                [("class_id", 1), ("deleted_at", 1), ("date", 1)],
                [("date", 1), ("status", 1)],
                [("deleted_at", 1)],
            ],
        )

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

        await _ensure(db.employees, [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]])
        await _ensure(db.locations, [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]])
        await _ensure(db.classes, [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]])
        await _ensure(
            db.activity_logs,
            [
                [("timestamp", -1)],
                [("entity_type", 1), ("entity_id", 1)],
                [("user_id", 1)],
            ],
        )
        await db.activity_logs.create_index("expires_at", expireAfterSeconds=0)
        await _ensure(db.users, [[("deleted_at", 1)]])
        await db.drive_time_cache.create_index("key", unique=True)
        await db.drive_time_cache.create_index("expires_at", expireAfterSeconds=0)

        await db.invitations.create_index("token", unique=True)
        await _ensure(db.invitations, ["email"])
        await db.invitations.create_index("expires_at", expireAfterSeconds=0)

        await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
        await db.password_resets.create_index("token", unique=True)
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.outlook_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.refresh_tokens.create_index("jti", unique=True)
        await _ensure(db.refresh_tokens, ["user_id"])
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.login_failures.create_index("email", unique=True)
        await db.login_failures.create_index("expires_at", expireAfterSeconds=0)

        await _ensure(
            db.projects,
            [
                [("partner_org_id", 1)],
                [("phase", 1)],
                [("community", 1)],
                [("deleted_at", 1)],
                [("schedule_id", 1), ("deleted_at", 1)],
            ],
        )
        await _ensure(
            db.tasks,
            [
                [("project_id", 1)],
                [("project_id", 1), ("phase", 1)],
                [("project_id", 1), ("completed", 1)],
            ],
        )
        await _ensure(
            db.partner_orgs,
            [
                [("community", 1)],
                [("status", 1)],
                [("deleted_at", 1)],
                [("location_id", 1), ("status", 1), ("deleted_at", 1)],
            ],
        )
        await _ensure(db.partner_contacts, [[("partner_org_id", 1)]])
        await _ensure(db.task_attachments, [[("task_id", 1)]])
        await _ensure(
            db.task_comments,
            [
                [("task_id", 1), ("created_at", 1)],
                [("task_id", 1), ("parent_comment_id", 1)],
            ],
        )
        await db.email_reminders.create_index([("task_id", 1), ("threshold_key", 1)], unique=True)
        await _ensure(db.email_reminders, [[("sent_at", -1)]])
        await _ensure(db.event_outcomes, [[("project_id", 1)], [("project_id", 1), ("status", 1)]])
        await db.promotion_checklists.create_index("project_id", unique=True)
        await _ensure(
            db.webhook_subscriptions,
            [[("active", 1), ("events", 1)], [("deleted_at", 1)]],
        )
        await _ensure(db.schedules, [[("series_id", 1), ("date", 1)]])
        await _ensure(
            db.messages,
            [
                [("project_id", 1), ("visibility", 1)],
                [("project_id", 1), ("created_at", -1)],
            ],
        )
        await _ensure(db.webhook_logs, [[("subscription_id", 1), ("sent_at", -1)]])
        await _ensure(db.documents, [[("project_id", 1)]])
        await db.portal_tokens.create_index("token", unique=True)
        await db.portal_tokens.create_index("expires_at", expireAfterSeconds=0)

        await _ensure(
            db.notifications,
            [
                [("principal_kind", 1), ("principal_id", 1), ("created_at", -1)],
                [("principal_kind", 1), ("principal_id", 1), ("read_at", 1), ("dismissed_at", 1)],
            ],
        )
        await _ensure(
            db.notification_queue,
            [[("principal_kind", 1), ("principal_id", 1), ("frequency", 1), ("sent_at", 1)]],
        )
        await db.notifications_sent.create_index([(
            "principal_kind", 1), ("principal_id", 1), ("type_key", 1), ("channel", 1), ("dedup_key", 1)], unique=True)

        ttl_partial_filter = {"created_at_date": {_MONGO_EXISTS: True}}
        await db.notifications.create_index(
            "created_at_date",
            expireAfterSeconds=60 * 60 * 24 * 365,
            partialFilterExpression=ttl_partial_filter,
        )
        await db.notifications_sent.create_index(
            "created_at_date",
            expireAfterSeconds=60 * 60 * 24 * 90,
            partialFilterExpression=ttl_partial_filter,
        )
        await db.notification_queue.create_index(
            "created_at_date",
            expireAfterSeconds=60 * 60 * 24 * 30,
            partialFilterExpression=ttl_partial_filter,
        )

        logger.info("Ensured indexes on all collections")
    except Exception as e:
        logger.warning(f"Failed to create indexes: {e}")
