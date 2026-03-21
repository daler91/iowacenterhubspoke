"""
Backend API tests for Class Series feature
Tests: Class CRUD, Schedule-Class linkage, Workload/Report class filtering
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test user credentials
TEST_EMAIL = f"test_class_{uuid.uuid4().hex[:8]}@test.com"
TEST_PASSWORD = "testpass123"
TEST_NAME = "Test Class User"


class TestSetup:
    """Setup fixtures for all tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        """Create a requests session"""
        return requests.Session()
    
    @pytest.fixture(scope="class")
    def auth_token(self, session):
        """Register a new user and get auth token"""
        # Register new user
        register_response = session.post(f"{BASE_URL}/api/auth/register", json={
            "name": TEST_NAME,
            "email": TEST_EMAIL,
            "password": TEST_PASSWORD
        })
        
        if register_response.status_code == 400:
            # User already exists, try login
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


class TestClassCRUD(TestSetup):
    """Test Class CRUD operations"""
    
    created_class_id = None
    
    def test_get_classes_empty_or_list(self, session, auth_headers):
        """GET /api/classes - should return list"""
        response = session.get(f"{BASE_URL}/api/classes", headers=auth_headers)
        assert response.status_code == 200, f"Failed to get classes: {response.text}"
        data = response.json()
        assert isinstance(data, list), "Classes response should be a list"
        print(f"PASS: GET /api/classes returned {len(data)} classes")
    
    def test_create_class(self, session, auth_headers):
        """POST /api/classes - create a new class"""
        payload = {
            "name": f"TEST_Financial_Literacy_{uuid.uuid4().hex[:6]}",
            "description": "Test class for financial literacy training",
            "color": "#0F766E"
        }
        response = session.post(f"{BASE_URL}/api/classes", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create class: {response.text}"
        
        data = response.json()
        assert "id" in data, "Created class should have an id"
        assert data["name"] == payload["name"], "Class name should match"
        assert data["description"] == payload["description"], "Class description should match"
        assert data["color"] == payload["color"], "Class color should match"
        
        TestClassCRUD.created_class_id = data["id"]
        print(f"PASS: POST /api/classes created class with id {data['id']}")
    
    def test_get_classes_contains_created(self, session, auth_headers):
        """GET /api/classes - should contain the created class"""
        response = session.get(f"{BASE_URL}/api/classes", headers=auth_headers)
        assert response.status_code == 200
        
        data = response.json()
        class_ids = [c["id"] for c in data]
        assert TestClassCRUD.created_class_id in class_ids, "Created class should be in list"
        print(f"PASS: GET /api/classes contains created class")
    
    def test_update_class(self, session, auth_headers):
        """PUT /api/classes/{id} - update class"""
        assert TestClassCRUD.created_class_id, "Need created class id"
        
        update_payload = {
            "name": f"TEST_Updated_Class_{uuid.uuid4().hex[:6]}",
            "description": "Updated description",
            "color": "#DC2626"
        }
        response = session.put(
            f"{BASE_URL}/api/classes/{TestClassCRUD.created_class_id}",
            json=update_payload,
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to update class: {response.text}"
        
        data = response.json()
        assert data["name"] == update_payload["name"], "Updated name should match"
        assert data["color"] == update_payload["color"], "Updated color should match"
        print(f"PASS: PUT /api/classes/{TestClassCRUD.created_class_id} updated successfully")
    
    def test_update_class_not_found(self, session, auth_headers):
        """PUT /api/classes/{id} - should return 404 for non-existent class"""
        fake_id = str(uuid.uuid4())
        response = session.put(
            f"{BASE_URL}/api/classes/{fake_id}",
            json={"name": "Test"},
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"PASS: PUT /api/classes/{fake_id} returns 404 for non-existent class")


class TestScheduleWithClass(TestSetup):
    """Test Schedule creation with Class linkage"""
    
    test_employee_id = None
    test_location_id = None
    test_class_id = None
    test_schedule_id = None
    
    def test_setup_employee(self, session, auth_headers):
        """Create test employee"""
        payload = {
            "name": f"TEST_Employee_{uuid.uuid4().hex[:6]}",
            "email": f"test_{uuid.uuid4().hex[:6]}@test.com",
            "color": "#4F46E5"
        }
        response = session.post(f"{BASE_URL}/api/employees", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create employee: {response.text}"
        TestScheduleWithClass.test_employee_id = response.json()["id"]
        print(f"PASS: Created test employee {TestScheduleWithClass.test_employee_id}")
    
    def test_setup_location(self, session, auth_headers):
        """Get existing location or create one"""
        response = session.get(f"{BASE_URL}/api/locations", headers=auth_headers)
        assert response.status_code == 200
        
        locations = response.json()
        if locations:
            TestScheduleWithClass.test_location_id = locations[0]["id"]
        else:
            # Create a location
            payload = {
                "city_name": f"TEST_City_{uuid.uuid4().hex[:6]}",
                "drive_time_minutes": 60
            }
            create_response = session.post(f"{BASE_URL}/api/locations", json=payload, headers=auth_headers)
            assert create_response.status_code == 200
            TestScheduleWithClass.test_location_id = create_response.json()["id"]
        
        print(f"PASS: Using location {TestScheduleWithClass.test_location_id}")
    
    def test_setup_class(self, session, auth_headers):
        """Create test class"""
        payload = {
            "name": f"TEST_Schedule_Class_{uuid.uuid4().hex[:6]}",
            "description": "Class for schedule testing",
            "color": "#7C3AED"
        }
        response = session.post(f"{BASE_URL}/api/classes", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create class: {response.text}"
        TestScheduleWithClass.test_class_id = response.json()["id"]
        print(f"PASS: Created test class {TestScheduleWithClass.test_class_id}")
    
    def test_create_schedule_with_class(self, session, auth_headers):
        """POST /api/schedules - create schedule with class_id"""
        assert TestScheduleWithClass.test_employee_id, "Need employee id"
        assert TestScheduleWithClass.test_location_id, "Need location id"
        assert TestScheduleWithClass.test_class_id, "Need class id"
        
        payload = {
            "employee_id": TestScheduleWithClass.test_employee_id,
            "location_id": TestScheduleWithClass.test_location_id,
            "class_id": TestScheduleWithClass.test_class_id,
            "date": "2026-02-15",
            "start_time": "09:00",
            "end_time": "12:00",
            "notes": "Test schedule with class"
        }
        response = session.post(f"{BASE_URL}/api/schedules", json=payload, headers=auth_headers)
        assert response.status_code == 200, f"Failed to create schedule: {response.text}"
        
        data = response.json()
        assert "id" in data, "Schedule should have id"
        assert data["class_id"] == TestScheduleWithClass.test_class_id, "class_id should match"
        assert "class_name" in data, "Schedule should have class_name"
        assert "class_color" in data, "Schedule should have class_color"
        
        TestScheduleWithClass.test_schedule_id = data["id"]
        print(f"PASS: Created schedule {data['id']} with class linkage")
        print(f"  - class_name: {data.get('class_name')}")
        print(f"  - class_color: {data.get('class_color')}")
    
    def test_get_schedules_has_class_info(self, session, auth_headers):
        """GET /api/schedules - schedules should include class info"""
        response = session.get(f"{BASE_URL}/api/schedules", headers=auth_headers)
        assert response.status_code == 200
        
        schedules = response.json()
        # Find our test schedule
        test_schedule = next((s for s in schedules if s["id"] == TestScheduleWithClass.test_schedule_id), None)
        assert test_schedule, "Test schedule should be in list"
        assert test_schedule.get("class_name"), "Schedule should have class_name"
        assert test_schedule.get("class_color"), "Schedule should have class_color"
        print(f"PASS: GET /api/schedules returns class info for schedule")
    
    def test_update_class_syncs_to_schedule(self, session, auth_headers):
        """PUT /api/classes/{id} - updating class should sync to linked schedules"""
        new_name = f"TEST_Renamed_Class_{uuid.uuid4().hex[:6]}"
        new_color = "#F97316"
        
        # Update the class
        response = session.put(
            f"{BASE_URL}/api/classes/{TestScheduleWithClass.test_class_id}",
            json={"name": new_name, "color": new_color},
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to update class: {response.text}"
        
        # Verify schedule has updated class info
        schedule_response = session.get(f"{BASE_URL}/api/schedules", headers=auth_headers)
        assert schedule_response.status_code == 200
        
        schedules = schedule_response.json()
        test_schedule = next((s for s in schedules if s["id"] == TestScheduleWithClass.test_schedule_id), None)
        assert test_schedule, "Test schedule should exist"
        assert test_schedule.get("class_name") == new_name, f"Schedule class_name should be updated to {new_name}"
        assert test_schedule.get("class_color") == new_color, f"Schedule class_color should be updated to {new_color}"
        print(f"PASS: Class update synced to schedule - name: {new_name}, color: {new_color}")


class TestClassDeletion(TestSetup):
    """Test class deletion preserves schedule data"""
    
    delete_class_id = None
    delete_schedule_id = None
    original_class_name = None
    
    def test_setup_for_deletion(self, session, auth_headers):
        """Setup class and schedule for deletion test"""
        # Get employee and location
        emp_response = session.get(f"{BASE_URL}/api/employees", headers=auth_headers)
        loc_response = session.get(f"{BASE_URL}/api/locations", headers=auth_headers)
        
        employees = emp_response.json()
        locations = loc_response.json()
        
        if not employees:
            emp_create = session.post(f"{BASE_URL}/api/employees", json={
                "name": f"TEST_Delete_Emp_{uuid.uuid4().hex[:6]}",
                "color": "#4F46E5"
            }, headers=auth_headers)
            employee_id = emp_create.json()["id"]
        else:
            employee_id = employees[0]["id"]
        
        location_id = locations[0]["id"] if locations else None
        assert location_id, "Need at least one location"
        
        # Create class
        class_name = f"TEST_ToDelete_Class_{uuid.uuid4().hex[:6]}"
        class_response = session.post(f"{BASE_URL}/api/classes", json={
            "name": class_name,
            "color": "#DC2626"
        }, headers=auth_headers)
        assert class_response.status_code == 200
        TestClassDeletion.delete_class_id = class_response.json()["id"]
        TestClassDeletion.original_class_name = class_name
        
        # Create schedule with this class - use unique date to avoid conflicts
        import random
        unique_date = f"2026-{random.randint(4, 12):02d}-{random.randint(1, 28):02d}"
        schedule_response = session.post(f"{BASE_URL}/api/schedules", json={
            "employee_id": employee_id,
            "location_id": location_id,
            "class_id": TestClassDeletion.delete_class_id,
            "date": unique_date,
            "start_time": "14:00",
            "end_time": "16:00"
        }, headers=auth_headers)
        assert schedule_response.status_code == 200, f"Failed to create schedule: {schedule_response.text}"
        TestClassDeletion.delete_schedule_id = schedule_response.json()["id"]
        print(f"PASS: Setup for deletion test - class: {TestClassDeletion.delete_class_id}, schedule: {TestClassDeletion.delete_schedule_id}")
    
    def test_delete_class_preserves_schedule(self, session, auth_headers):
        """DELETE /api/classes/{id} - should preserve schedule with class info"""
        # Delete the class
        response = session.delete(
            f"{BASE_URL}/api/classes/{TestClassDeletion.delete_class_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to delete class: {response.text}"
        
        # Verify schedule still exists and has class info preserved
        schedule_response = session.get(f"{BASE_URL}/api/schedules", headers=auth_headers)
        assert schedule_response.status_code == 200
        
        schedules = schedule_response.json()
        test_schedule = next((s for s in schedules if s["id"] == TestClassDeletion.delete_schedule_id), None)
        assert test_schedule, "Schedule should still exist after class deletion"
        assert test_schedule.get("class_id") is None, "class_id should be null after deletion"
        assert test_schedule.get("class_name") == TestClassDeletion.original_class_name, "class_name should be preserved"
        print(f"PASS: Class deleted, schedule preserved with class_name: {test_schedule.get('class_name')}")
    
    def test_delete_class_not_found(self, session, auth_headers):
        """DELETE /api/classes/{id} - should return 404 for non-existent class"""
        fake_id = str(uuid.uuid4())
        response = session.delete(f"{BASE_URL}/api/classes/{fake_id}", headers=auth_headers)
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"PASS: DELETE /api/classes/{fake_id} returns 404")


class TestWorkloadWithClass(TestSetup):
    """Test Workload endpoint with class breakdown"""
    
    def test_workload_has_class_breakdown(self, session, auth_headers):
        """GET /api/workload - should include class_breakdown per employee"""
        response = session.get(f"{BASE_URL}/api/workload", headers=auth_headers)
        assert response.status_code == 200, f"Failed to get workload: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Workload should be a list"
        
        # Check structure of workload items
        for item in data:
            assert "employee_id" in item, "Workload item should have employee_id"
            assert "employee_name" in item, "Workload item should have employee_name"
            assert "class_breakdown" in item, "Workload item should have class_breakdown"
            
            # Check class_breakdown structure
            for class_item in item.get("class_breakdown", []):
                assert "class_name" in class_item, "class_breakdown item should have class_name"
                assert "class_color" in class_item, "class_breakdown item should have class_color"
                assert "classes" in class_item, "class_breakdown item should have classes count"
        
        print(f"PASS: GET /api/workload returns {len(data)} employees with class_breakdown")


class TestWeeklyReportWithClass(TestSetup):
    """Test Weekly Report endpoint with class filtering"""
    
    def test_weekly_report_has_class_totals(self, session, auth_headers):
        """GET /api/reports/weekly-summary - should include class_totals"""
        response = session.get(
            f"{BASE_URL}/api/reports/weekly-summary",
            params={"date_from": "2026-01-01", "date_to": "2026-12-31"},
            headers=auth_headers
        )
        assert response.status_code == 200, f"Failed to get weekly report: {response.text}"
        
        data = response.json()
        assert "totals" in data, "Report should have totals"
        assert "class_totals" in data, "Report should have class_totals"
        assert "employees" in data, "Report should have employees"
        
        # Check class_totals structure
        for class_item in data.get("class_totals", []):
            assert "class_name" in class_item, "class_totals item should have class_name"
            assert "class_color" in class_item, "class_totals item should have class_color"
            assert "classes" in class_item, "class_totals item should have classes count"
        
        # Check employee class_breakdown
        for emp in data.get("employees", []):
            assert "class_breakdown" in emp, "Employee should have class_breakdown"
            for detail in emp.get("schedule_details", []):
                assert "class_name" in detail, "Schedule detail should have class_name"
                assert "class_color" in detail, "Schedule detail should have class_color"
        
        print(f"PASS: GET /api/reports/weekly-summary has class_totals and employee class_breakdown")
    
    def test_weekly_report_class_filter(self, session, auth_headers):
        """GET /api/reports/weekly-summary with class_id filter"""
        # First get a class id
        classes_response = session.get(f"{BASE_URL}/api/classes", headers=auth_headers)
        classes = classes_response.json()
        
        if classes:
            class_id = classes[0]["id"]
            response = session.get(
                f"{BASE_URL}/api/reports/weekly-summary",
                params={"date_from": "2026-01-01", "date_to": "2026-12-31", "class_id": class_id},
                headers=auth_headers
            )
            assert response.status_code == 200, f"Failed to get filtered report: {response.text}"
            print(f"PASS: GET /api/reports/weekly-summary with class_id filter works")
        else:
            print("SKIP: No classes available for filter test")


def _delete_matching(session, auth_headers, endpoint, filter_fn):
    resp = session.get(f"{BASE_URL}/api/{endpoint}", headers=auth_headers)
    if resp.status_code == 200:
        for item in resp.json():
            if filter_fn(item):
                session.delete(f"{BASE_URL}/api/{endpoint}/{item['id']}", headers=auth_headers)


class TestCleanup(TestSetup):
    """Cleanup test data"""

    def test_cleanup_test_data(self, session, auth_headers):
        """Clean up TEST_ prefixed data"""
        _delete_matching(session, auth_headers, "classes", lambda c: c["name"].startswith("TEST_"))
        _delete_matching(session, auth_headers, "employees", lambda e: e["name"].startswith("TEST_"))
        _delete_matching(session, auth_headers, "schedules", lambda s: (s.get("notes") or "").startswith("Test"))
        print("PASS: Cleanup completed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
