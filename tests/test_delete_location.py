import pytest
from unittest.mock import MagicMock, AsyncMock, patch
import os
import sys

# Set environment variables for the test
os.environ['MONGO_URL'] = 'mongodb://localhost:27017'
os.environ['DB_NAME'] = 'testdb'
os.environ['JWT_SECRET'] = 'test_secret_key'

# Mock dotenv and motor to avoid real network/file operations during import
import dotenv
dotenv.load_dotenv = lambda *args, **kwargs: None

sys.modules['motor'] = MagicMock()
sys.modules['motor.motor_asyncio'] = MagicMock()

from fastapi.testclient import TestClient
from backend.server import app, get_current_user

# Create the test client and override the authentication dependency
client = TestClient(app)
app.dependency_overrides[get_current_user] = lambda: {"user_id": "test_user", "name": "Test User"}

@pytest.fixture
def mock_delete_one():
    # Because backend.server.db is a MagicMock (due to our motor mock above),
    # we need to patch the delete_one method on it to be an AsyncMock.
    with patch('backend.server.db.locations.delete_one', new_callable=AsyncMock) as mock:
        yield mock

def test_delete_location_success(mock_delete_one):
    """Test successful deletion of a location."""
    # Setup the mock to return a result indicating 1 document was deleted
    mock_result = MagicMock()
    mock_result.deleted_count = 1
    mock_delete_one.return_value = mock_result

    # Make the request using the test client
    response = client.delete("/api/locations/loc-123")

    # Assert the response is correct
    assert response.status_code == 200
    assert response.json() == {"message": "Location deleted"}

    # Verify the database method was called with the correct arguments
    mock_delete_one.assert_called_once_with({"id": "loc-123"})

def test_delete_location_not_found(mock_delete_one):
    """Test deletion of a non-existent location."""
    # Setup the mock to return a result indicating 0 documents were deleted
    mock_result = MagicMock()
    mock_result.deleted_count = 0
    mock_delete_one.return_value = mock_result

    # Make the request using the test client
    response = client.delete("/api/locations/loc-456")

    # Assert the response is a 404
    assert response.status_code == 404
    assert response.json() == {"detail": "Location not found"}

    # Verify the database method was called with the correct arguments
    mock_delete_one.assert_called_once_with({"id": "loc-456"})
