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

if _IS_PRODUCTION and not _KEY and not _IS_TEST:
    raise RuntimeError(
        "TOKEN_ENCRYPTION_KEY is required in production. "
        "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
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
