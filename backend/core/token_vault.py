import os
import logging

logger = logging.getLogger(__name__)

_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY", "")


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
    from cryptography.fernet import Fernet
    try:
        f = Fernet(_KEY.encode())
        return f.decrypt(ciphertext.encode()).decode()
    except Exception:
        # Graceful fallback: may be a plaintext token from before encryption was enabled
        logger.warning("Failed to decrypt token — returning as-is (may be pre-encryption plaintext)")
        return ciphertext
