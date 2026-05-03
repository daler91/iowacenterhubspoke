import os

from core.constants import ROLE_ADMIN, USER_STATUS_APPROVED

_MONGO_EXISTS = "$exists"


async def run_startup_migrations(db, logger):
    """Migrate existing users and promote admin if configured."""
    try:
        result = await db.users.update_many(
            {"status": {_MONGO_EXISTS: False}},
            {"$set": {"status": USER_STATUS_APPROVED}},
        )
        if result.modified_count > 0:
            logger.info(f"Migrated {result.modified_count} existing users to approved status")
    except Exception as e:
        logger.warning(f"Failed to migrate user statuses: {e}")

    admin_email = os.getenv("ADMIN_EMAIL")
    if not admin_email:
        return
    try:
        existing_admin = await db.users.find_one({"email": admin_email})
        if existing_admin and existing_admin.get("role") != ROLE_ADMIN:
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"role": ROLE_ADMIN, "status": USER_STATUS_APPROVED}},
            )
            logger.info("Promoted configured admin user")
    except Exception as e:
        logger.warning(f"Failed to check/promote admin user: {e}")
