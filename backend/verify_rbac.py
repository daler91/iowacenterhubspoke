import os
import sys

# Set environment variable before importing core.auth
os.environ["JWT_SECRET"] = "test_secret"

from core.auth import create_token  # noqa: E402
import jwt  # noqa: E402

JWT_SECRET = "test_secret"


def test_token_role():
    user_id = "123"
    email = "test@example.com"
    name = "Test User"
    role = "admin"

    token = create_token(user_id, email, name, role)
    payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

    assert payload["role"] == role
    assert payload["email"] == email


if __name__ == "__main__":
    try:
        test_token_role()
    except Exception as e:
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)
