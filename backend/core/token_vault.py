import os
import logging

logger = logging.getLogger(__name__)

_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY", "")

_OAUTH_ENABLED = bool(
    os.environ.get("GOOGLE_CLIENT_ID") or os.environ.get("OUTLOOK_CLIENT_ID")
)
_ALLOW_UNENCRYPTED = os.environ.get("ALLOW_UNENCRYPTED_TOKENS") == "1"

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
    """Encrypt a token for at-rest storage. Returns plaintext if no key configured."""
    if not _KEY:
        return plaintext
    from cryptography.fernet import Fernet
    f = Fernet(_KEY.encode())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a stored token. Returns input unchanged if no key configured."""
    if not _KEY:
        return ciphertext
    from cryptography.fernet import Fernet, InvalidToken
    try:
        f = Fernet(_KEY.encode())
        return f.decrypt(ciphertext.encode()).decode()
    except (ValueError, InvalidToken):
        # Graceful fallback: may be a plaintext token from before encryption was enabled
        logger.warning("Failed to decrypt token — returning as-is (may be pre-encryption plaintext)")
        return ciphertext
