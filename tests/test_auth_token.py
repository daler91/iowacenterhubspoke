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

# Instead of global sys.modules modification which bleeds to other tests,
# we use the patch.dict context manager or fixture to ONLY mock during the test execution.
# However, `from backend.server import create_token` imports it at module level.
# To safely test without real dependencies breaking import, we can mock sys.modules
# ONLY before the import, but then RESTORE them after the import, or just mock them for
# the whole test run cleanly without breaking other tests.
# The simplest fix is to NOT mock fastapi globally. `create_token` only requires `jwt` and `datetime`.
# It doesn't need fastapi. It only needs `JWT_SECRET` and `JWT_ALGORITHM`.
# Let's just import backend.server while safely mocking ONLY what prevents it from importing.

# We only mock dotenv and motor which actually do work on import (load_dotenv, motor client)
_original_modules = sys.modules.copy()
sys.modules['dotenv'] = MagicMock()
sys.modules['motor'] = MagicMock()
sys.modules['motor.motor_asyncio'] = MagicMock()

from backend.server import create_token, JWT_SECRET, JWT_ALGORITHM

# Restore sys.modules so we don't bleed mocks to other tests
sys.modules.update(_original_modules)
del sys.modules['dotenv']
del sys.modules['motor']
del sys.modules['motor.motor_asyncio']

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
