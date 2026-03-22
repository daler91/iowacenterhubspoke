import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
TEST_EMAIL = f"test_workload_{uuid.uuid4().hex[:8]}@test.com"
TEST_PASSWORD = os.environ['TEST_PASSWORD']
TEST_NAME = "Test Workload User"

class TestSetup:
    @pytest.fixture(scope="class")
    def session(self):
        return requests.Session()

    @pytest.fixture(scope="class")
    def auth_token(self, session):
        register_response = session.post(f"{BASE_URL}/api/auth/register", json={
            "name": TEST_NAME,
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        if register_response.status_code == 400:
            login_response = session.post(f"{BASE_URL}/api/auth/login", json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            })
            assert login_response.status_code == 200
            return login_response.json()["token"]
        assert register_response.status_code == 200
        return register_response.json()["token"]

    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        return {"Authorization": f"Bearer {auth_token}"}

class TestWorkloadErrors(TestSetup):
    employee_id = None
    location_id = None
    schedule_id = None

    def test_setup_employee(self, session, auth_headers):
        payload = {
            "name": f"TEST_Workload_Emp_{uuid.uuid4().hex[:6]}",
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
            "color": "#4F46E5"
        }
        response = session.post(f"{BASE_URL}/api/employees", json=payload, headers=auth_headers)
        assert response.status_code == 200
        TestWorkloadErrors.employee_id = response.json()["id"]

    def test_setup_location(self, session, auth_headers):
        response = session.get(f"{BASE_URL}/api/locations", headers=auth_headers)
        assert response.status_code == 200
        locations = response.json()
        if locations:
            TestWorkloadErrors.location_id = locations[0]["id"]
        else:
            payload = {
                "city_name": f"TEST_City_{uuid.uuid4().hex[:6]}",
                "drive_time_minutes": 60
            }
            create_response = session.post(f"{BASE_URL}/api/locations", json=payload, headers=auth_headers)
            assert create_response.status_code == 200
            TestWorkloadErrors.location_id = create_response.json()["id"]

    def test_create_schedule_and_update_invalid_time(self, session, auth_headers):
        assert TestWorkloadErrors.employee_id
        assert TestWorkloadErrors.location_id

        # Create a schedule with valid time
        payload = {
            "employee_id": TestWorkloadErrors.employee_id,
            "location_id": TestWorkloadErrors.location_id,
            "date": "2026-03-01",
            "start_time": "09:00",
            "end_time": "12:00",
            "notes": "Test invalid time"
        }
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200
        TestWorkloadErrors.schedule_id = response.json()["id"]

        # Update schedule with invalid time to trigger ValueError during split(':')
        update_payload = {
            "start_time": "invalid_time"
        }
        update_response = session.put(
            f"{BASE_URL}/api/schedules/{TestWorkloadErrors.schedule_id}",
            json=update_payload,
            headers=auth_headers
        )
        assert update_response.status_code == 200

    def test_get_workload_stats_with_invalid_time(self, session, auth_headers):
        # Trigger the get_workload_stats endpoint
        response = session.get(f"{BASE_URL}/api/workload", headers=auth_headers)
        # Verify it doesn't crash (should be 200 OK)
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)

        # Verify that our specific employee's workload is retrieved successfully
        emp_workload = next((item for item in data if item["employee_id"] == TestWorkloadErrors.employee_id), None)
        assert emp_workload is not None

        # Due to invalid time, class_minutes is set to 0, which means total_class_hours should be 0.0
        assert emp_workload["total_class_hours"] == pytest.approx(0.0)

        # Also check employee stats endpoint which has a similar try/except block
        emp_stats_response = session.get(f"{BASE_URL}/api/employees/{TestWorkloadErrors.employee_id}/stats", headers=auth_headers)
        assert emp_stats_response.status_code == 200
        emp_stats = emp_stats_response.json()
        assert emp_stats["total_class_minutes"] == 0

class TestCleanup(TestSetup):
    def test_cleanup_test_data(self, session, auth_headers):
        def _delete_matching(endpoint, filter_fn):
            resp = session.get(f"{BASE_URL}/api/{endpoint}", headers=auth_headers)
            if resp.status_code == 200:
                for item in resp.json():
                    if filter_fn(item):
                        session.delete(f"{BASE_URL}/api/{endpoint}/{item['id']}", headers=auth_headers)

        _delete_matching("employees", lambda e: e["name"].startswith("TEST_Workload_Emp_"))
        _delete_matching("schedules", lambda s: (s.get("notes") or "") == "Test invalid time")

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
