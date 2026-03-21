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

# Mock all dependencies of backend.server to allow importing get_current_user
# without a full environment setup.
@pytest.fixture(autouse=True)
def mock_dependencies():
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
        yield

sys.modules['fastapi'] = MagicMock()
sys.modules['fastapi.middleware.cors'] = MagicMock()
sys.modules['motor'] = MagicMock()
sys.modules['motor.motor_asyncio'] = MagicMock()
sys.modules['bcrypt'] = MagicMock()
sys.modules['starlette.middleware.cors'] = MagicMock()
sys.modules['dotenv'] = MagicMock()
sys.modules['pydantic'] = MagicMock()

# Now we can import the module securely
import backend.server
from backend.server import get_current_user, JWT_SECRET, JWT_ALGORITHM

# To test the HTTP exception, we need a local mocked HTTPException class since fastapi is mocked
class MockHTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail

backend.server.HTTPException = MockHTTPException

@pytest.mark.asyncio
async def test_get_current_user_no_auth():
    with pytest.raises(MockHTTPException) as excinfo:
        await get_current_user(authorization=None)
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == 'Not authenticated'

@pytest.mark.asyncio
async def test_get_current_user_invalid_scheme():
    with pytest.raises(MockHTTPException) as excinfo:
        await get_current_user(authorization="Basic token123")
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == 'Not authenticated'

@pytest.mark.asyncio
async def test_get_current_user_invalid_token():
    with pytest.raises(MockHTTPException) as excinfo:
        await get_current_user(authorization="Bearer invalid_token_123")
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == 'Invalid token'

@pytest.mark.asyncio
async def test_get_current_user_expired_token():
    # Create an expired token
    payload = {
        'user_id': '123',
        'exp': datetime.now(timezone.utc).timestamp() - 3600  # expired 1 hour ago
    }
    expired_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    with pytest.raises(MockHTTPException) as excinfo:
        await get_current_user(authorization=f"Bearer {expired_token}")
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == 'Token expired'

@pytest.mark.asyncio
async def test_get_current_user_valid_token():
    # Create a valid token
    payload = {
        'user_id': '123',
        'name': 'Test User',
        'exp': datetime.now(timezone.utc).timestamp() + 3600
    }
    valid_token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    result = await get_current_user(authorization=f"Bearer {valid_token}")

    assert result['user_id'] == '123'
    assert result['name'] == 'Test User'
