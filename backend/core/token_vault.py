import os
import sys
import logging

logger = logging.getLogger(__name__)

_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY", "")
_IS_PRODUCTION = (
    os.environ.get("ENVIRONMENT", "development") == "production"
    or bool(os.environ.get("RAILWAY_ENVIRONMENT"))
)
# Under pytest a local ``.env`` that sets ``ENVIRONMENT=production`` would
# otherwise trip this guard at collection time. Skip the check when
# pytest is driving the process so tests can import real modules.
_IS_TEST = "pytest" in sys.modules or bool(os.environ.get("PYTEST_CURRENT_TEST"))

_ALLOW_UNENCRYPTED = os.environ.get("ALLOW_UNENCRYPTED_TOKENS") == "1"

# Booting without a key in production is dangerous: previously encrypted
# webhook secrets and refresh tokens come back as ciphertext (see
# ``decrypt_token`` below), which silently breaks HMAC signing and OAuth
# refresh. Fail-fast so ops notices. Fresh deployments with no encrypted
# data yet can opt in with ``ALLOW_UNENCRYPTED_TOKENS=1``.
if _IS_PRODUCTION and not _KEY and not _IS_TEST:
    if _ALLOW_UNENCRYPTED:
        logger.warning(
            "TOKEN_ENCRYPTION_KEY is not set in production but"
            " ALLOW_UNENCRYPTED_TOKENS=1. Tokens and webhook secrets will"
            " be stored in plaintext, and any previously encrypted values"
            " will be unreadable. This escape hatch is temporary."
        )
    else:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is required in production. Set"
            " ALLOW_UNENCRYPTED_TOKENS=1 to proceed without encryption"
            " (fresh deployments only — previously encrypted values will"
            " become unreadable). Generate one with: python -c"
            " \"from cryptography.fernet import Fernet;"
            " print(Fernet.generate_key().decode())\""
        )

_OAUTH_ENABLED = bool(
    os.environ.get("GOOGLE_CLIENT_ID") or os.environ.get("OUTLOOK_CLIENT_ID")
)

if _OAUTH_ENABLED and not _KEY:
    if _ALLOW_UNENCRYPTED:
        # Grace window: log loudly so ops can't miss this on a boot scroll.
        # The escape hatch will be removed in the next release — rotate the
        # key before upgrading.
        logger.warning(
            "TOKEN_ENCRYPTION_KEY is not set but OAuth credentials are"
            " configured. Refresh tokens will be stored in PLAINTEXT because"
            " ALLOW_UNENCRYPTED_TOKENS=1. This escape hatch is temporary;"
            " set TOKEN_ENCRYPTION_KEY before the next release."
        )
    else:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY must be set when GOOGLE_CLIENT_ID or"
            " OUTLOOK_CLIENT_ID is configured. Set ALLOW_UNENCRYPTED_TOKENS=1"
            " for a one-release grace window while you rotate secrets."
        )


def encrypt_token(plaintext: str) -> str:
    """Encrypt a token for at-rest storage. Returns plaintext if no key configured (dev only)."""
    if not _KEY:
        return plaintext
    from cryptography.fernet import Fernet
    f = Fernet(_KEY.encode())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a stored token. Returns input unchanged if no key configured (dev only)."""
    if not _KEY:
        return ciphertext
    from cryptography.fernet import Fernet, InvalidToken
    try:
        f = Fernet(_KEY.encode())
        return f.decrypt(ciphertext.encode()).decode()
    except (ValueError, InvalidToken):
        logger.warning("Failed to decrypt token — returning as-is (may be pre-encryption plaintext)")
        return ciphertext
