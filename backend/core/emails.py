"""Canonical email normalisation.

Email addresses are stored lower-cased and every lookup normalises its input
before querying, so the storage form and the query form always agree.

Why this module exists: registration used to dup-check case-insensitively but
store the address exactly as typed, while login, password reset, and the
partner magic link all did exact-match lookups. A user who signed up as
``Bob@Example.com`` could therefore never log in as ``bob@example.com``, could
not re-register (the dup check found them), and could not reset their password
(the reset job's lookup missed, and the anti-enumeration design makes that
miss silently indistinguishable from success). Normalising on both write and
read closes all three at once.

Prefer this over a case-insensitive regex query: ``{"$regex": "^...$",
"$options": "i"}`` cannot use a plain index, so it would turn every login into
a collection scan.
"""

from typing import Optional


def normalize_email(email: Optional[str]) -> str:
    """Return the canonical storage/lookup form of ``email``.

    Lower-cases and strips surrounding whitespace. Returns ``""`` for None so
    callers can pass user input straight through without a None check; an
    empty string simply matches nothing.
    """
    if not email:
        return ""
    return email.strip().lower()
