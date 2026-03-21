"""
Backend API tests for Recurrence Features
Tests: Monthly recurrence, Custom recurrence (weekly/monthly), end rules (never/on_date/after_occurrences)
"""
import pytest
import requests
import os
import uuid
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_EMAIL = f"test_recurrence_{uuid.uuid4().hex[:8]}@test.com"
TEST_PASSWORD = os.environ.get('TEST_PASSWORD', 'testpass123')
TEST_NAME = "Test Recurrence User"


class TestRecurrenceSetup:
    """Setup fixtures for recurrence tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create a requests session"""
        return requests.Session()
    
    @pytest.fixture(scope="class")
    def auth_token(self, session):
        """Register a new user and get auth token"""
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
            assert login_response.status_code == 200, f"Login failed: {login_response.text}"
            return login_response.json()["token"]
        
        assert register_response.status_code == 200, f"Registration failed: {register_response.text}"
        return register_response.json()["token"]
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get authorization headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    @pytest.fixture(scope="class")
    def test_employee(self, session, auth_headers):
        """Create test employee for recurrence tests"""
        payload = {
            "name": f"TEST_Recurrence_Emp_{uuid.uuid4().hex[:6]}",
            "email": f"test_rec_{uuid.uuid4().hex[:6]}@test.com",
            "color": "#4F46E5"
        }
        response = session.post(f"{BASE_URL}/api/employees", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create employee: {response.text}"
        return response.json()
    
    @pytest.fixture(scope="class")
    def test_location(self, session, auth_headers):
        """Get or create test location"""
        response = session.get(f"{BASE_URL}/api/locations", headers=auth_headers)
        assert response.status_code == 200
        
        locations = response.json()
        if locations:
            return locations[0]
        
        payload = {
            "city_name": f"TEST_Recurrence_City_{uuid.uuid4().hex[:6]}",
            "drive_time_minutes": 45
        }
        create_response = session.post(f"{BASE_URL}/api/locations", json=payload, headers=auth_headers)
        assert create_response.status_code == 200
        return create_response.json()
    
    @pytest.fixture(scope="class")
    def test_class(self, session, auth_headers):
        """Create test class for recurrence tests"""
        payload = {
            "name": f"TEST_Recurrence_Class_{uuid.uuid4().hex[:6]}",
            "description": "Class for recurrence testing",
            "color": "#7C3AED"
        }
        response = session.post(f"{BASE_URL}/api/classes", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create class: {response.text}"
        return response.json()


class TestMonthlyRecurrence(TestRecurrenceSetup):
    """Test Monthly recurrence feature"""
    
    created_schedule_ids = []
    
    def test_monthly_recurrence_with_occurrences(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with monthly recurrence and after_occurrences end mode"""
        start_date = "2026-03-15"
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "10:00",
            "end_time": "12:00",
            "notes": "Test monthly recurrence",
            "recurrence": "monthly",
            "recurrence_end_mode": "after_occurrences",
            "recurrence_occurrences": 3
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create monthly schedule: {response.text}"
        
        data = response.json()
        
        # Should return batch result with multiple schedules
        assert "created" in data, "Response should have 'created' array for recurring schedules"
        assert "total_created" in data, "Response should have 'total_created' count"
        assert data["total_created"] == 3, f"Expected 3 monthly occurrences, got {data['total_created']}"
        
        # Verify dates are monthly apart
        created_dates = [s["date"] for s in data["created"]]
        assert "2026-03-15" in created_dates, "First date should be 2026-03-15"
        assert "2026-04-15" in created_dates, "Second date should be 2026-04-15"
        assert "2026-05-15" in created_dates, "Third date should be 2026-05-15"
        
        # Store IDs for cleanup
        TestMonthlyRecurrence.created_schedule_ids = [s["id"] for s in data["created"]]
        
        print(f"PASS: Monthly recurrence created {data['total_created']} schedules on dates: {created_dates}")
    
    def test_monthly_recurrence_with_end_date(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with monthly recurrence and on_date end mode"""
        start_date = "2026-06-10"
        end_date = "2026-09-30"
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "14:00",
            "end_time": "16:00",
            "notes": "Test monthly with end date",
            "recurrence": "monthly",
            "recurrence_end_mode": "on_date",
            "recurrence_end_date": end_date
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create monthly schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        
        # Should create schedules from June to September (4 months)
        created_dates = [s["date"] for s in data["created"]]
        assert len(created_dates) == 4, f"Expected 4 monthly occurrences (Jun-Sep), got {len(created_dates)}"
        
        # Verify all dates are within range
        for date_str in created_dates:
            assert date_str >= start_date, f"Date {date_str} should be >= {start_date}"
            assert date_str <= end_date, f"Date {date_str} should be <= {end_date}"
        
        # Store IDs for cleanup
        TestMonthlyRecurrence.created_schedule_ids.extend([s["id"] for s in data["created"]])
        
        print(f"PASS: Monthly recurrence with end_date created {len(created_dates)} schedules: {created_dates}")
    
    def test_monthly_recurrence_never_end(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with monthly recurrence and never end mode (should create 24 occurrences)"""
        start_date = "2026-10-01"
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "08:00",
            "end_time": "10:00",
            "notes": "Test monthly never end",
            "recurrence": "monthly",
            "recurrence_end_mode": "never"
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create monthly schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        
        # Never-ending monthly should create 24 occurrences (default limit)
        assert data["total_created"] == 24, f"Expected 24 monthly occurrences for 'never' end mode, got {data['total_created']}"
        
        # Store IDs for cleanup
        TestMonthlyRecurrence.created_schedule_ids.extend([s["id"] for s in data["created"]])
        
        print(f"PASS: Monthly recurrence with 'never' end mode created {data['total_created']} schedules")


class TestCustomRecurrence(TestRecurrenceSetup):
    """Test Custom recurrence feature"""
    
    created_schedule_ids = []
    
    def test_custom_weekly_with_weekdays(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with custom weekly recurrence selecting specific weekdays"""
        start_date = "2026-02-02"  # Monday
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "09:00",
            "end_time": "11:00",
            "notes": "Test custom weekly",
            "recurrence": "custom",
            "custom_recurrence": {
                "interval": 1,
                "frequency": "week",
                "weekdays": [1, 3, 5],  # Monday, Wednesday, Friday
                "end_mode": "after_occurrences",
                "occurrences": 6
            }
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create custom schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        assert data["total_created"] == 6, f"Expected 6 occurrences, got {data['total_created']}"
        
        # Verify weekdays are correct (Mon=1, Wed=3, Fri=5 in our 0=Sun system)
        created_dates = [s["date"] for s in data["created"]]
        for date_str in created_dates:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            weekday = (date_obj.weekday() + 1) % 7  # Convert to 0=Sun system
            assert weekday in [1, 3, 5], f"Date {date_str} has weekday {weekday}, expected Mon/Wed/Fri"
        
        TestCustomRecurrence.created_schedule_ids = [s["id"] for s in data["created"]]
        
        print(f"PASS: Custom weekly recurrence created {data['total_created']} schedules on Mon/Wed/Fri: {created_dates}")
    
    def test_custom_biweekly_with_weekdays(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with custom every-2-weeks recurrence"""
        start_date = "2026-02-03"  # Tuesday
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "13:00",
            "end_time": "15:00",
            "notes": "Test custom biweekly",
            "recurrence": "custom",
            "custom_recurrence": {
                "interval": 2,
                "frequency": "week",
                "weekdays": [2, 4],  # Tuesday, Thursday
                "end_mode": "after_occurrences",
                "occurrences": 4
            }
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create custom schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        assert data["total_created"] == 4, f"Expected 4 occurrences, got {data['total_created']}"
        
        TestCustomRecurrence.created_schedule_ids.extend([s["id"] for s in data["created"]])
        
        print(f"PASS: Custom biweekly recurrence created {data['total_created']} schedules")
    
    def test_custom_monthly_recurrence(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with custom monthly recurrence"""
        start_date = "2026-01-20"
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "10:00",
            "end_time": "12:00",
            "notes": "Test custom monthly",
            "recurrence": "custom",
            "custom_recurrence": {
                "interval": 1,
                "frequency": "month",
                "weekdays": [],  # Not used for monthly
                "end_mode": "after_occurrences",
                "occurrences": 3
            }
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create custom monthly schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        assert data["total_created"] == 3, f"Expected 3 monthly occurrences, got {data['total_created']}"
        
        # Verify dates are monthly apart
        created_dates = [s["date"] for s in data["created"]]
        assert "2026-01-20" in created_dates, "First date should be 2026-01-20"
        assert "2026-02-20" in created_dates, "Second date should be 2026-02-20"
        assert "2026-03-20" in created_dates, "Third date should be 2026-03-20"
        
        TestCustomRecurrence.created_schedule_ids.extend([s["id"] for s in data["created"]])
        
        print(f"PASS: Custom monthly recurrence created {data['total_created']} schedules: {created_dates}")
    
    def test_custom_recurrence_with_end_date(self, session, auth_headers, test_employee, test_location, test_class):
        """POST /api/schedules with custom recurrence and on_date end mode"""
        start_date = "2026-04-01"
        end_date = "2026-04-30"
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "16:00",
            "end_time": "18:00",
            "notes": "Test custom with end date",
            "recurrence": "custom",
            "custom_recurrence": {
                "interval": 1,
                "frequency": "week",
                "weekdays": [3],  # Wednesday only
                "end_mode": "on_date",
                "end_date": end_date
            }
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create custom schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        
        # April 2026 has 4 Wednesdays (1st, 8th, 15th, 22nd, 29th) - but start is April 1 which is Wednesday
        created_dates = [s["date"] for s in data["created"]]
        for date_str in created_dates:
            assert date_str >= start_date, f"Date {date_str} should be >= {start_date}"
            assert date_str <= end_date, f"Date {date_str} should be <= {end_date}"
        
        TestCustomRecurrence.created_schedule_ids.extend([s["id"] for s in data["created"]])
        
        print(f"PASS: Custom recurrence with end_date created {len(created_dates)} schedules: {created_dates}")


class TestRecurrenceRuleStorage(TestRecurrenceSetup):
    """Test that recurrence rules are stored correctly in schedules"""
    
    def test_schedule_stores_recurrence_rule(self, session, auth_headers, test_employee, test_location, test_class):
        """Verify that created schedules store the recurrence_rule"""
        start_date = "2026-05-01"
        
        payload = {
            "employee_id": test_employee["id"],
            "location_id": test_location["id"],
            "class_id": test_class["id"],
            "date": start_date,
            "start_time": "09:00",
            "end_time": "11:00",
            "notes": "Test recurrence rule storage",
            "recurrence": "custom",
            "custom_recurrence": {
                "interval": 2,
                "frequency": "week",
                "weekdays": [1, 5],  # Monday, Friday
                "end_mode": "after_occurrences",
                "occurrences": 2
            }
        }
        
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create schedule: {response.text}"
        
        data = response.json()
        assert "created" in data, "Response should have 'created' array"
        
        # Check first schedule has recurrence_rule stored
        first_schedule = data["created"][0]
        assert "recurrence_rule" in first_schedule, "Schedule should have recurrence_rule"
        
        rule = first_schedule["recurrence_rule"]
        assert rule["interval"] == 2, "Interval should be 2"
        assert rule["frequency"] == "week", "Frequency should be week"
        assert 1 in rule["weekdays"], "Weekdays should include Monday (1)"
        assert 5 in rule["weekdays"], "Weekdays should include Friday (5)"
        
        print(f"PASS: Schedule stores recurrence_rule correctly: {rule}")


class TestRecurrenceCleanup(TestRecurrenceSetup):
    """Cleanup test data"""
    
    def test_cleanup_test_data(self, session, auth_headers):
        """Clean up TEST_ prefixed data"""
        # Get and delete test schedules
        schedules_response = session.get(f"{BASE_URL}/api/schedules", headers=auth_headers)
        if schedules_response.status_code == 200:
            for s in schedules_response.json():
                notes = s.get("notes") or ""
                if "Test" in notes and ("recurrence" in notes.lower() or "monthly" in notes.lower() or "custom" in notes.lower()):
                    session.delete(f"{BASE_URL}/api/schedules/{s['id']}", headers=auth_headers)
        
        # Get and delete test classes
        classes_response = session.get(f"{BASE_URL}/api/classes", headers=auth_headers)
        if classes_response.status_code == 200:
            for c in classes_response.json():
                if c["name"].startswith("TEST_Recurrence"):
                    session.delete(f"{BASE_URL}/api/classes/{c['id']}", headers=auth_headers)
        
        # Get and delete test employees
        emp_response = session.get(f"{BASE_URL}/api/employees", headers=auth_headers)
        if emp_response.status_code == 200:
            for e in emp_response.json():
                if e["name"].startswith("TEST_Recurrence"):
                    session.delete(f"{BASE_URL}/api/employees/{e['id']}", headers=auth_headers)
        
        print("PASS: Cleanup completed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
