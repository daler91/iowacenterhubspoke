"""Migration-managed secondary indexes.

These indexes are intentionally not created at app boot so rollout latency and
startup blast radius stay low. Apply via migration tooling before deploying
new app instances.
"""

from pymongo.errors import OperationFailure

from core.logger import get_logger

_MONGO_EXISTS = "$exists"
_MONGO_OUT_OF_DISK_CODE = 14031

logger = get_logger(__name__)


def _is_out_of_disk(exc: OperationFailure) -> bool:
    return getattr(exc, "code", None) == _MONGO_OUT_OF_DISK_CODE


async def _ensure(collection, specs):
    for spec in specs:
        try:
            if isinstance(spec, tuple):
                keys, kwargs = spec
                await collection.create_index(keys, **kwargs)
            else:
                await collection.create_index(spec)
        except OperationFailure as exc:
            if _is_out_of_disk(exc):
                logger.warning(
                    "Skipping index creation for %s due to low disk space: %s",
                    collection.name,
                    exc,
                )
                continue
            raise


async def _create_index(collection, keys, **kwargs):
    try:
        await collection.create_index(keys, **kwargs)
    except OperationFailure as exc:
        if _is_out_of_disk(exc):
            logger.warning(
                "Skipping index creation for %s due to low disk space: %s",
                collection.name,
                exc,
            )
            return
        raise


async def run(db) -> int:
    await _ensure(
        db.schedules,
        [
            [("employee_ids", 1), ("deleted_at", 1), ("date", 1)],
            [("location_id", 1), ("deleted_at", 1), ("date", 1)],
            [("class_id", 1), ("deleted_at", 1), ("date", 1)],
            [("date", 1), ("status", 1)],
            [("deleted_at", 1)],
            [("series_id", 1), ("date", 1)],
        ],
    )
    await _ensure(
        db.employees,
        [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]],
    )
    await _ensure(
        db.locations,
        [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]],
    )
    await _ensure(
        db.classes,
        [[("id", 1), ("deleted_at", 1)], [("deleted_at", 1)]],
    )
    await _ensure(
        db.activity_logs,
        [
            [("timestamp", -1)],
            [("entity_type", 1), ("entity_id", 1)],
            [("user_id", 1)],
        ],
    )
    await _create_index(db.activity_logs, "expires_at", expireAfterSeconds=0)
    await _ensure(db.users, [[("deleted_at", 1)]])
    await _create_index(db.drive_time_cache, "key", unique=True)
    await _create_index(db.drive_time_cache, "expires_at", expireAfterSeconds=0)
    await _ensure(db.invitations, ["email"])
    await _ensure(db.refresh_tokens, ["user_id"])

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
    await _create_index(
        db.email_reminders,
        [("task_id", 1), ("threshold_key", 1)],
        unique=True,
    )
    await _ensure(db.email_reminders, [[("sent_at", -1)]])
    await _ensure(
        db.event_outcomes,
        [[("project_id", 1)], [("project_id", 1), ("status", 1)]],
    )
    await _create_index(db.promotion_checklists, "project_id", unique=True)
    await _ensure(
        db.webhook_subscriptions,
        [[("active", 1), ("events", 1)], [("deleted_at", 1)]],
    )
    await _ensure(
        db.messages,
        [
            [("project_id", 1), ("visibility", 1)],
            [("project_id", 1), ("created_at", -1)],
        ],
    )
    await _ensure(db.webhook_logs, [[("subscription_id", 1), ("sent_at", -1)]])
    await _ensure(db.documents, [[("project_id", 1)]])

    await _ensure(
        db.notifications,
        [
            [("principal_kind", 1), ("principal_id", 1), ("created_at", -1)],
            [
                ("principal_kind", 1),
                ("principal_id", 1),
                ("read_at", 1),
                ("dismissed_at", 1),
            ],
        ],
    )
    await _ensure(
        db.notification_queue,
        [
            [
                ("principal_kind", 1),
                ("principal_id", 1),
                ("frequency", 1),
                ("sent_at", 1),
            ]
        ],
    )
    await _create_index(
        db.notifications_sent,
        [
            ("principal_kind", 1),
            ("principal_id", 1),
            ("type_key", 1),
            ("channel", 1),
            ("dedup_key", 1),
        ],
        unique=True,
    )

    ttl_partial_filter = {"created_at_date": {_MONGO_EXISTS: True}}
    await _create_index(
        db.notifications,
        "created_at_date",
        expireAfterSeconds=60 * 60 * 24 * 365,
        partialFilterExpression=ttl_partial_filter,
    )
    await _create_index(
        db.notifications_sent,
        "created_at_date",
        expireAfterSeconds=60 * 60 * 24 * 90,
        partialFilterExpression=ttl_partial_filter,
    )
    await _create_index(
        db.notification_queue,
        "created_at_date",
        expireAfterSeconds=60 * 60 * 24 * 30,
        partialFilterExpression=ttl_partial_filter,
    )
    return 1
