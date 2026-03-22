import sys
import os
import secrets
from unittest.mock import MagicMock

# Mock out required dependencies to test auth logic
sys.modules['fastapi'] = MagicMock()
sys.modules['bcrypt'] = MagicMock()

import jwt
from backend.core.auth import create_token

def test_create_token():
    # Test token creation
    token = create_token("user1", "test@test.com", "Test User")
    assert token is not None

    # Try decoding it with the same secrets object
    from backend.core.auth import JWT_SECRET, JWT_ALGORITHM

    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload['user_id'] == "user1"
    assert payload['email'] == "test@test.com"
    print("All simple auth tests passed!")

if __name__ == "__main__":
    test_create_token()
