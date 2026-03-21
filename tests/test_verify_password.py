import pytest
import os
import sys
from unittest.mock import MagicMock, patch

# Set environment variables
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'testdb'
os.environ['JWT_SECRET'] = 'test_secret_key'

import bcrypt

# Since test_auth_token.py no longer permanently pollutes sys.modules,
# we can just patch what we need for importing backend.server safely!

with patch.dict(sys.modules, {
    'fastapi': MagicMock(),
    'fastapi.middleware.cors': MagicMock(),
    'motor': MagicMock(),
    'motor.motor_asyncio': MagicMock(),
    'starlette.middleware.cors': MagicMock(),
    'dotenv': MagicMock(),
    'pydantic': MagicMock()
}):
    # Important: Ensure bcrypt is the real one
    if 'bcrypt' in sys.modules and isinstance(sys.modules['bcrypt'], MagicMock):
        sys.modules['bcrypt'] = bcrypt

    # Reload backend.server if it was loaded by test_auth_token with mocks
    import importlib
    if 'backend.server' in sys.modules:
        importlib.reload(sys.modules['backend.server'])
    from backend.server import hash_password, verify_password

def test_verify_password_correct():
    password = "my_secure_password"
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    assert verify_password(password, hashed) is True

def test_verify_password_incorrect():
    password = "my_secure_password"
    wrong_password = "wrong_password"
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    assert verify_password(wrong_password, hashed) is False

def test_verify_password_empty_string():
    password = ""
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    assert verify_password(password, hashed) is True
    assert verify_password("not_empty", hashed) is False

def test_hash_password_generates_string():
    password = "my_secure_password"
    hashed = hash_password(password)
    assert isinstance(hashed, str)
    assert len(hashed) > 0
    # Ensure it's a valid bcrypt hash format
    assert hashed.startswith('$2b$')

def test_hash_password_salts_correctly():
    password = "my_secure_password"
    hashed1 = hash_password(password)
    hashed2 = hash_password(password)
    # Due to salting, two hashes of the same password should be different
    assert hashed1 != hashed2
    # Both should still verify correctly
    assert verify_password(password, hashed1) is True
    assert verify_password(password, hashed2) is True
