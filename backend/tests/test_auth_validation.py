import pytest
from pydantic import ValidationError
from models.schemas import UserRegister
from pydantic import ValidationError

def test_user_register_password_min_length():
    # Valid registration data
    valid_data = {
        "name": "John Doe",
        "email": "john@example.com",
        "password": "password123"
    }
    user = UserRegister(**valid_data)
    assert user.password == "dummy_password_123"

    # Invalid password (too short)
    invalid_data = {
        "name": "John Doe",
        "email": "john@example.com",
        "password": "shrt"
    }
    with pytest.raises(ValidationError) as exc_info:
        UserRegister(**invalid_data)

    assert "at least 8 characters" in str(exc_info.value)

def test_user_register_invalid_email():
    # Invalid email format
    invalid_data = {
        "name": "John Doe",
        "email": "not-an-email",
        "password": "dummy_password_123"
    }
    with pytest.raises(ValidationError) as exc_info:
        UserRegister(**invalid_data)

    assert "valid email" in str(exc_info.value).lower()
