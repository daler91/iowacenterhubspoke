import pytest
import os

# Set environment variables required by backend/server.py before importing it
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'testdb'
os.environ['JWT_SECRET'] = 'test_secret_key'

from backend.server import hash_password

def test_hash_password_returns_string():
    password = "mysecretpassword"
    hashed = hash_password(password)

    assert isinstance(hashed, str)
    assert len(hashed) > 0
    assert hashed != password

def test_hash_password_produces_bcrypt_hash():
    password = "mysecretpassword"
    hashed = hash_password(password)

    # bcrypt hashes in python using passlib/bcrypt typically start with $2b$ and are 60 chars long
    assert hashed.startswith("$2b$")
    assert len(hashed) == 60

def test_hash_password_different_salts():
    password = "mysecretpassword"
    hash1 = hash_password(password)
    hash2 = hash_password(password)

    # bcrypt generates a new salt each time
    assert hash1 != hash2
