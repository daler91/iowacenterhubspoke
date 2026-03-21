import jwt
import pytest
import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

# Set environment variables
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'testdb'
os.environ['JWT_SECRET'] = 'test_secret_key'

# Mock all dependencies of backend.server to allow importing create_token
# without a full environment setup.
# USE patch.dict to avoid permanently polluting sys.modules!
# Wait, let's just mock dependencies around the import of create_token.

# Actually, we can just use patch.dict at module level but it leaves sys.modules polluted.
# Let's fix test_auth_token.py to NOT pollute sys.modules globally!

# We do this by importing safely with a context manager.
import importlib

# Clean up any bad state before starting
for mod in ['fastapi', 'fastapi.middleware.cors', 'motor', 'motor.motor_asyncio', 'bcrypt', 'starlette.middleware.cors', 'dotenv', 'pydantic', 'backend.server']:
    if mod in sys.modules:
        if isinstance(sys.modules[mod], MagicMock):
            del sys.modules[mod]

# Import with mocked dependencies just for this module by using a fixture
# But since we need create_token, we can just mock the specific external calls
# actually wait, create_token doesn't use fastapi, motor, etc.
# But backend.server does on import!
# Let's cleanly patch sys.modules ONLY around the import.

with patch.dict(sys.modules, {
    'fastapi': MagicMock(),
    'fastapi.middleware.cors': MagicMock(),
    'motor': MagicMock(),
    'motor.motor_asyncio': MagicMock(),
    'bcrypt': MagicMock(),
    'starlette.middleware.cors': MagicMock(),
    'dotenv': MagicMock(),
    'pydantic': MagicMock()
}):
    from backend.server import create_token, JWT_SECRET, JWT_ALGORITHM

def test_create_token_success():
    user_id = "user123"
    email = "test@example.com"
    name = "Test User"

    token = create_token(user_id, email, name)

    assert isinstance(token, str)
    assert len(token) > 0

    # Decode token to verify payload
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

    assert payload['user_id'] == user_id
    assert payload['email'] == email
    assert payload['name'] == name

    # Verify expiration (should be 7 days from now as per backend/server.py:102)
    exp = payload['exp']
    now = datetime.now(timezone.utc).timestamp()
    expected_exp = now + 86400 * 7

    # Allow for a small time difference (e.g., 10 seconds)
    assert abs(exp - expected_exp) < 10

def test_create_token_different_inputs():
    user_id = "another_id"
    email = "another@test.com"
    name = "Another Name"

    token = create_token(user_id, email, name)
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])

    assert payload['user_id'] == user_id
    assert payload['email'] == email
    assert payload['name'] == name

def test_create_token_invalid_secret():
    user_id = "user123"
    email = "test@example.com"
    name = "Test User"

    token = create_token(user_id, email, name)

    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, "wrong_secret", algorithms=[JWT_ALGORITHM])
