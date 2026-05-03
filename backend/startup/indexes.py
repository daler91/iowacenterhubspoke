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
        await db.invitations.create_index("token", unique=True)
        await db.invitations.create_index("email")
        await db.invitations.create_index("expires_at", expireAfterSeconds=0)
        await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
        await db.password_resets.create_index("token", unique=True)
        await db.google_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.outlook_oauth_states.create_index("created_at", expireAfterSeconds=1800)
        await db.refresh_tokens.create_index("jti", unique=True)
        await db.refresh_tokens.create_index("user_id")
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.login_failures.create_index("email", unique=True)
        await db.login_failures.create_index("expires_at", expireAfterSeconds=0)
        await db.projects.create_index([("partner_org_id", 1)])
        await db.projects.create_index([("phase", 1)])
        await db.projects.create_index([("community", 1)])
        await db.projects.create_index([("deleted_at", 1)])
        await db.projects.create_index([("schedule_id", 1), ("deleted_at", 1)])
        await db.tasks.create_index([("project_id", 1)])
        await db.tasks.create_index([("project_id", 1), ("phase", 1)])
        await db.tasks.create_index([("project_id", 1), ("completed", 1)])
        await db.partner_orgs.create_index([("community", 1)])
        await db.partner_orgs.create_index([("status", 1)])
        await db.partner_orgs.create_index([("deleted_at", 1)])
        await db.partner_orgs.create_index([("location_id", 1), ("status", 1), ("deleted_at", 1)])
        await db.partner_contacts.create_index([("partner_org_id", 1)])
        await db.task_attachments.create_index([("task_id", 1)])
        await db.task_comments.create_index([("task_id", 1), ("created_at", 1)])
        await db.task_comments.create_index([("task_id", 1), ("parent_comment_id", 1)])
        await db.email_reminders.create_index([("task_id", 1), ("threshold_key", 1)], unique=True)
        await db.email_reminders.create_index([("sent_at", -1)])
        await db.event_outcomes.create_index([("project_id", 1)])
        await db.event_outcomes.create_index([("project_id", 1), ("status", 1)])
        await db.promotion_checklists.create_index("project_id", unique=True)
        await db.webhook_subscriptions.create_index([("active", 1), ("events", 1)])
        await db.webhook_subscriptions.create_index([("deleted_at", 1)])
        await db.schedules.create_index([("series_id", 1), ("date", 1)])
        await db.messages.create_index([("project_id", 1), ("visibility", 1)])
        await db.webhook_logs.create_index([("subscription_id", 1), ("sent_at", -1)])
        await db.documents.create_index([("project_id", 1)])
        await db.messages.create_index([("project_id", 1), ("created_at", -1)])
        await db.portal_tokens.create_index("token", unique=True)
        await db.portal_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.notifications.create_index(
            [("principal_kind", 1), ("principal_id", 1), ("created_at", -1)],
        )
        await db.notifications.create_index(
            [("principal_kind", 1), ("principal_id", 1), ("read_at", 1), ("dismissed_at", 1)],
        )
        await db.notification_queue.create_index(
            [("principal_kind", 1), ("principal_id", 1), ("frequency", 1), ("sent_at", 1)],
        )
        await db.notifications_sent.create_index(
            [
                ("principal_kind", 1), ("principal_id", 1),
                ("type_key", 1), ("channel", 1), ("dedup_key", 1),
            ],
            unique=True,
        )
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
