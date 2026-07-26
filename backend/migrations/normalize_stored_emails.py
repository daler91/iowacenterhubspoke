"""One-time migration: lower-case stored email addresses.

Registration used to store the address exactly as typed while every lookup
(login, password reset, partner magic link) did an exact match, so an account
created as ``Bob@Example.com`` was unreachable via ``bob@example.com``. The
application now normalises on write *and* read (``core.emails``); this
migration brings existing rows onto the same form so the new lookups find them.

Collections touched: ``users``, ``partner_contacts``, ``invitations``.

**Collisions.** Two rows in the same collection whose emails differ only by
case would become duplicates. Registration's duplicate check has always been
case-insensitive so this should not occur, but seeded/imported rows could
bypass it and silently merging identities is not something a migration should
decide. We therefore detect collisions and raise, leaving the database
untouched — the runner records the failure and refuses to start the app, which
is the correct outcome for an ambiguity a human must resolve.

Idempotent: rows already lower-cased are not matched by the update.

Ad-hoc execution against an arbitrary deployment::

    python -m migrations.normalize_stored_emails
"""

from collections import defaultdict

from core.logger import get_logger

logger = get_logger(__name__)

_COLLECTIONS = ("users", "partner_contacts", "invitations")


async def _find_collisions(collection) -> dict:
    """Return ``{normalised_email: [raw, raw, ...]}`` for any that collide."""
    by_normalized = defaultdict(list)
    async for doc in collection.find(
        {"email": {"$type": "string"}}, {"_id": 0, "email": 1},
    ):
        raw = doc["email"]
        by_normalized[raw.strip().lower()].append(raw)
    return {
        normalized: raws
        for normalized, raws in by_normalized.items()
        if len(set(raws)) > 1
    }


async def run(db) -> int:
    """Lower-case ``email`` on every affected document. Returns rows updated."""
    total = 0
    for name in _COLLECTIONS:
        collection = db[name]

        collisions = await _find_collisions(collection)
        if collisions:
            detail = "; ".join(
                f"{normalized} <- {sorted(set(raws))}"
                for normalized, raws in sorted(collisions.items())
            )
            raise RuntimeError(
                f"Cannot normalise {name}.email: {len(collisions)} address(es) "
                f"differ only by case and would collide. Resolve these by hand "
                f"(merge or delete the duplicates), then re-run. Details: {detail}"
            )

        updated = 0
        async for doc in collection.find(
            {"email": {"$type": "string"}}, {"_id": 1, "email": 1},
        ):
            normalized = doc["email"].strip().lower()
            if normalized == doc["email"]:
                continue
            await collection.update_one(
                {"_id": doc["_id"]}, {"$set": {"email": normalized}},
            )
            updated += 1

        if updated:
            logger.info("Normalised %d %s email(s)", updated, name)
        total += updated

    return total


if __name__ == "__main__":
    import asyncio
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv

    load_dotenv()
    _client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    _db = _client[os.environ.get("DB_NAME", "iowa_center_hub")]
    asyncio.run(run(_db))
    _client.close()
