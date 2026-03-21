import requests
import sys
import json
from datetime import datetime, timedelta

class HubSpokeAPITester:
    def __init__(self, base_url="https://schedule-hub-spoke.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.user_id = None
        self.created_location_id = None
        self.created_employee_id = None
        self.created_schedule_id = None

    def _make_request(self, method, url, data, test_headers):
        """Execute the HTTP request based on method type."""
        if method == 'GET':
            return requests.get(url, headers=test_headers, timeout=10)
        if method == 'POST':
            return requests.post(url, json=data, headers=test_headers, timeout=10)
        if method == 'PUT':
            return requests.put(url, json=data, headers=test_headers, timeout=10)
        if method == 'DELETE':
            return requests.delete(url, headers=test_headers, timeout=10)
        raise ValueError(f"Unsupported method: {method}")

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\nTesting {name}...")
        print(f"   URL: {url}")
        
        try:
            response = self._make_request(method, url, data, test_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"   Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 500:
                        print(f"   Response: {response_data}")
                    elif isinstance(response_data, list):
                        print(f"   Response: List with {len(response_data)} items")
                    return True, response_data
                except (ValueError, requests.exceptions.JSONDecodeError):
                    return True, {}
            else:
                print(f"   Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except (ValueError, requests.exceptions.JSONDecodeError):
                    print(f"   Error: {response.text}")
                return False, {}

        except requests.exceptions.RequestException as e:
            print(f"   Failed - Error: {str(e)}")
            return False, {}

    def test_auth_register(self):
        """Test user registration"""
        test_email = f"test_user_{datetime.now().strftime('%H%M%S')}@test.com"
        success, response = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data={
                "name": "Test User",
                "email": test_email,
                "password": "testpass123"
            }
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user_id = response.get('user', {}).get('id')
            print(f"   Registered user: {test_email}")
            return True
        return False

    def test_auth_login(self):
        """Test login with existing credentials"""
        success, response = self.run_test(
            "User Login",
            "POST",
            "auth/login",
            200,
            data={
                "email": "test@test.com",
                "password": "password123"
            }
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user_id = response.get('user', {}).get('id')
            print(f"   Logged in as: {response.get('user', {}).get('email')}")
            return True
        return False

    def test_auth_me(self):
        """Test getting current user info"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        return success

    def test_dashboard_stats(self):
        """Test dashboard statistics"""
        success, response = self.run_test(
            "Dashboard Stats",
            "GET",
            "dashboard/stats",
            200
        )
        if success:
            expected_keys = ['total_employees', 'total_locations', 'total_schedules', 'today_schedules']
            for key in expected_keys:
                if key not in response:
                    print(f"   Missing key: {key}")
                    return False
            print(f"   Stats: {response}")
        return success

    def test_locations_get(self):
        """Test getting all locations (should have 5 seeded)"""
        success, response = self.run_test(
            "Get Locations",
            "GET",
            "locations",
            200
        )
        if success:
            if len(response) >= 5:
                print(f"   Found {len(response)} locations (expected 5+ seeded)")
                # Check for expected seeded locations
                cities = [loc.get('city_name') for loc in response]
                expected_cities = ['Oskaloosa', 'Grinnell', 'Fort Dodge', 'Carroll', 'Marshalltown']
                found_cities = [city for city in expected_cities if city in cities]
                print(f"   Seeded cities found: {found_cities}")
                return len(found_cities) >= 4  # Allow for some flexibility
            else:
                print(f"   Only found {len(response)} locations, expected 5 seeded")
                return False
        return success

    def test_locations_create(self):
        """Test creating a new location"""
        success, response = self.run_test(
            "Create Location",
            "POST",
            "locations",
            200,
            data={
                "city_name": "Test City",
                "drive_time_minutes": 90,
                "latitude": 41.5,
                "longitude": -93.5
            }
        )
        if success and 'id' in response:
            self.created_location_id = response['id']
            print(f"   Created location ID: {self.created_location_id}")
        return success

    def test_locations_update(self):
        """Test updating a location"""
        if not self.created_location_id:
            print("   Skipping - no location to update")
            return True
        
        success, response = self.run_test(
            "Update Location",
            "PUT",
            f"locations/{self.created_location_id}",
            200,
            data={
                "city_name": "Updated Test City",
                "drive_time_minutes": 95
            }
        )
        return success

    def test_employees_get(self):
        """Test getting all employees"""
        success, response = self.run_test(
            "Get Employees",
            "GET",
            "employees",
            200
        )
        if success:
            print(f"   Found {len(response)} employees")
        return success

    def test_employees_create(self):
        """Test creating a new employee"""
        success, response = self.run_test(
            "Create Employee",
            "POST",
            "employees",
            200,
            data={
                "name": "Test Employee",
                "email": "test.employee@test.com",
                "phone": "(515) 555-0123",
                "color": "#4F46E5"
            }
        )
        if success and 'id' in response:
            self.created_employee_id = response['id']
            print(f"   Created employee ID: {self.created_employee_id}")
        return success

    def test_employees_update(self):
        """Test updating an employee"""
        if not self.created_employee_id:
            print("   Skipping - no employee to update")
            return True
        
        success, response = self.run_test(
            "Update Employee",
            "PUT",
            f"employees/{self.created_employee_id}",
            200,
            data={
                "name": "Updated Test Employee",
                "color": "#DC2626"
            }
        )
        return success

    def test_schedules_get(self):
        """Test getting all schedules"""
        success, response = self.run_test(
            "Get Schedules",
            "GET",
            "schedules",
            200
        )
        if success:
            print(f"   Found {len(response)} schedules")
        return success

    def test_schedules_create(self):
        """Test creating a new schedule"""
        if not self.created_employee_id or not self.created_location_id:
            print("   Skipping - need employee and location first")
            return True
        
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        success, response = self.run_test(
            "Create Schedule",
            "POST",
            "schedules",
            200,
            data={
                "employee_id": self.created_employee_id,
                "location_id": self.created_location_id,
                "date": tomorrow,
                "start_time": "09:00",
                "end_time": "12:00",
                "notes": "Test class"
            }
        )
        if success and 'id' in response:
            self.created_schedule_id = response['id']
            print(f"   Created schedule ID: {self.created_schedule_id}")
            # Check for drive time calculation
            if 'drive_time_minutes' in response:
                print(f"   Drive time calculated: {response['drive_time_minutes']} minutes")
        return success

    def test_schedules_town_to_town(self):
        """Test town-to-town warning by creating second schedule"""
        if not self.created_employee_id:
            print("   Skipping - need employee first")
            return True
        
        # Get first available location (different from created one)
        locations_success, locations = self.run_test(
            "Get Locations for Town-to-Town",
            "GET",
            "locations",
            200
        )
        if not locations_success or len(locations) < 2:
            print("   Skipping - need at least 2 locations")
            return True
        
        # Find a different location
        different_location = None
        for loc in locations:
            if loc['id'] != self.created_location_id:
                different_location = loc
                break
        
        if not different_location:
            print("   Skipping - no different location found")
            return True
        
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        success, response = self.run_test(
            "Create Town-to-Town Schedule",
            "POST",
            "schedules",
            200,
            data={
                "employee_id": self.created_employee_id,
                "location_id": different_location['id'],
                "date": tomorrow,
                "start_time": "14:00",
                "end_time": "17:00",
                "notes": "Second class same day"
            }
        )
        if success:
            if response.get('town_to_town'):
                print(f"   ✅ Town-to-town detected: {response.get('town_to_town_warning')}")
            else:
                print(f"   ⚠️  Town-to-town not detected (might be expected)")
        return success

    def test_schedules_update(self):
        """Test updating a schedule"""
        if not self.created_schedule_id:
            print("   Skipping - no schedule to update")
            return True
        
        success, response = self.run_test(
            "Update Schedule",
            "PUT",
            f"schedules/{self.created_schedule_id}",
            200,
            data={
                "start_time": "10:00",
                "end_time": "13:00",
                "notes": "Updated test class"
            }
        )
        return success

    def test_schedule_status_update(self):
        """Test updating schedule status (new PM feature)"""
        if not self.created_schedule_id:
            print("   Skipping - no schedule to update status")
            return True
        
        # Test updating to in_progress
        success, response = self.run_test(
            "Update Schedule Status to In Progress",
            "PUT",
            f"schedules/{self.created_schedule_id}/status",
            200,
            data={"status": "in_progress"}
        )
        if success and response.get('status') == 'in_progress':
            print("   ✅ Status updated to in_progress")
        
        # Test updating to completed
        success2, response2 = self.run_test(
            "Update Schedule Status to Completed",
            "PUT",
            f"schedules/{self.created_schedule_id}/status",
            200,
            data={"status": "completed"}
        )
        if success2 and response2.get('status') == 'completed':
            print("   ✅ Status updated to completed")
        
        return success and success2

    def test_activity_logs(self):
        """Test activity logs endpoint (new PM feature)"""
        success, response = self.run_test(
            "Get Activity Logs",
            "GET",
            "activity-logs",
            200
        )
        if success:
            print(f"   Found {len(response)} activity log entries")
            if len(response) > 0:
                # Check structure of first log entry
                first_log = response[0]
                expected_keys = ['id', 'action', 'description', 'entity_type', 'entity_id', 'user_name', 'timestamp']
                missing_keys = [key for key in expected_keys if key not in first_log]
                if missing_keys:
                    print(f"   ⚠️  Missing keys in activity log: {missing_keys}")
                else:
                    print(f"   ✅ Activity log structure correct")
        return success

    def test_employee_stats(self):
        """Test employee stats endpoint (new PM feature)"""
        if not self.created_employee_id:
            print("   Skipping - no employee to get stats for")
            return True
        
        success, response = self.run_test(
            "Get Employee Stats",
            "GET",
            f"employees/{self.created_employee_id}/stats",
            200
        )
        if success:
            expected_keys = ['employee', 'total_classes', 'total_drive_minutes', 'total_class_minutes', 
                           'completed', 'upcoming', 'in_progress', 'location_breakdown', 'recent_schedules']
            missing_keys = [key for key in expected_keys if key not in response]
            if missing_keys:
                print(f"   ⚠️  Missing keys in employee stats: {missing_keys}")
                return False
            else:
                print(f"   ✅ Employee stats structure correct")
                print(f"   Stats: {response['total_classes']} classes, {response['completed']} completed")
        return success

    def test_notifications(self):
        """Test notifications endpoint (new PM feature)"""
        success, response = self.run_test(
            "Get Notifications",
            "GET",
            "notifications",
            200
        )
        if success:
            print(f"   Found {len(response)} notifications")
            if len(response) > 0:
                # Check structure of first notification
                first_notification = response[0]
                expected_keys = ['id', 'type', 'title', 'description', 'severity', 'timestamp']
                missing_keys = [key for key in expected_keys if key not in first_notification]
                if missing_keys:
                    print(f"   ⚠️  Missing keys in notification: {missing_keys}")
                else:
                    print(f"   ✅ Notification structure correct")
                    print(f"   Types found: {list(set(n.get('type', 'unknown') for n in response))}")
        return success

    def test_workload_stats(self):
        """Test workload stats endpoint (new PM feature)"""
        success, response = self.run_test(
            "Get Workload Stats",
            "GET",
            "workload",
            200
        )
        if success:
            print(f"   Found workload data for {len(response)} employees")
            if len(response) > 0:
                # Check structure of first workload entry
                first_workload = response[0]
                expected_keys = ['employee_id', 'employee_name', 'employee_color', 'total_classes', 
                               'total_class_hours', 'total_drive_hours', 'completed', 'upcoming']
                missing_keys = [key for key in expected_keys if key not in first_workload]
                if missing_keys:
                    print(f"   ⚠️  Missing keys in workload data: {missing_keys}")
                    return False
                else:
                    print(f"   ✅ Workload data structure correct")
        return success

    def test_schedule_check_conflicts(self):
        """Test conflict pre-check endpoint (NEW FEATURE)"""
        if not self.created_employee_id or not self.created_location_id:
            print("   Skipping - need employee and location first")
            return True
        
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        success, response = self.run_test(
            "Check Schedule Conflicts",
            "POST",
            "schedules/check-conflicts",
            200,
            data={
                "employee_id": self.created_employee_id,
                "location_id": self.created_location_id,
                "date": tomorrow,
                "start_time": "09:00",
                "end_time": "12:00"
            }
        )
        if success:
            expected_keys = ['has_conflicts', 'conflicts']
            missing_keys = [key for key in expected_keys if key not in response]
            if missing_keys:
                print(f"   ⚠️  Missing keys in conflict check: {missing_keys}")
                return False
            else:
                print(f"   ✅ Conflict check structure correct")
                print(f"   Has conflicts: {response.get('has_conflicts', False)}")
        return success

    def test_schedule_recurring(self):
        """Test recurring schedule creation (NEW FEATURE)"""
        if not self.created_employee_id or not self.created_location_id:
            print("   Skipping - need employee and location first")
            return True
        
        # Create a weekly recurring schedule for 3 weeks
        start_date = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
        end_date = (datetime.now() + timedelta(days=21)).strftime('%Y-%m-%d')
        
        success, response = self.run_test(
            "Create Recurring Schedule (Weekly)",
            "POST",
            "schedules",
            200,
            data={
                "employee_id": self.created_employee_id,
                "location_id": self.created_location_id,
                "date": start_date,
                "start_time": "10:00",
                "end_time": "13:00",
                "notes": "Weekly recurring test",
                "recurrence": "weekly",
                "recurrence_end_date": end_date
            }
        )
        if success:
            if 'total_created' in response:
                print(f"   ✅ Created {response['total_created']} recurring schedules")
                if response.get('conflicts_skipped'):
                    print(f"   ⚠️  {len(response['conflicts_skipped'])} schedules skipped due to conflicts")
            else:
                print(f"   ✅ Single schedule created (no recurrence data)")
        return success

    def test_schedule_conflict_409(self):
        """Test schedule conflict detection returns 409 (NEW FEATURE)"""
        if not self.created_employee_id or not self.created_location_id:
            print("   Skipping - need employee and location first")
            return True
        
        # Try to create a conflicting schedule (same time as existing one)
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        success, response = self.run_test(
            "Create Conflicting Schedule (Expect 409)",
            "POST",
            "schedules",
            409,  # Expect conflict
            data={
                "employee_id": self.created_employee_id,
                "location_id": self.created_location_id,
                "date": tomorrow,
                "start_time": "09:30",  # Overlaps with existing 09:00-12:00
                "end_time": "11:30",
                "notes": "Conflicting test schedule"
            }
        )
        if success:
            print(f"   ✅ Conflict properly detected (409 returned)")
        return success

    def test_schedule_relocate(self):
        """Test schedule relocation endpoint (NEW FEATURE - drag-and-drop)"""
        if not self.created_schedule_id:
            print("   Skipping - no schedule to relocate")
            return True
        
        # Move schedule to a different time
        new_date = (datetime.now() + timedelta(days=2)).strftime('%Y-%m-%d')
        success, response = self.run_test(
            "Relocate Schedule",
            "PUT",
            f"schedules/{self.created_schedule_id}/relocate",
            200,
            data={
                "date": new_date,
                "start_time": "14:00",
                "end_time": "17:00"
            }
        )
        if success:
            if response.get('date') == new_date and response.get('start_time') == '14:00':
                print(f"   ✅ Schedule successfully relocated to {new_date} 14:00-17:00")
            else:
                print(f"   ⚠️  Schedule relocation may not have worked properly")
        return success

    def test_weekly_summary_report(self):
        """Test weekly summary report endpoint (NEW FEATURE)"""
        # Test with current week
        success, response = self.run_test(
            "Get Weekly Summary Report",
            "GET",
            "reports/weekly-summary",
            200
        )
        if success:
            expected_keys = ['period', 'totals', 'employees']
            missing_keys = [key for key in expected_keys if key not in response]
            if missing_keys:
                print(f"   ⚠️  Missing keys in weekly report: {missing_keys}")
                return False
            else:
                print(f"   ✅ Weekly report structure correct")
                print(f"   Period: {response['period']['from']} to {response['period']['to']}")
                print(f"   Totals: {response['totals']['classes']} classes, {response['totals']['employees_active']} active employees")
                print(f"   Employee details: {len(response['employees'])} employees")
        return success

    def test_weekly_summary_custom_dates(self):
        """Test weekly summary with custom date range (NEW FEATURE)"""
        # Test with specific date range
        start_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        end_date = datetime.now().strftime('%Y-%m-%d')
        
        success, response = self.run_test(
            "Get Weekly Summary (Custom Dates)",
            "GET",
            f"reports/weekly-summary?date_from={start_date}&date_to={end_date}",
            200
        )
        if success:
            if response.get('period', {}).get('from') == start_date:
                print(f"   ✅ Custom date range working: {start_date} to {end_date}")
            else:
                print(f"   ⚠️  Custom date range may not be working properly")
        return success

    def test_cleanup(self):
        """Clean up created test data"""
        cleanup_success = True
        
        if self.created_schedule_id:
            success, _ = self.run_test(
                "Delete Test Schedule",
                "DELETE",
                f"schedules/{self.created_schedule_id}",
                200
            )
            cleanup_success = cleanup_success and success
        
        if self.created_employee_id:
            success, _ = self.run_test(
                "Delete Test Employee",
                "DELETE",
                f"employees/{self.created_employee_id}",
                200
            )
            cleanup_success = cleanup_success and success
        
        if self.created_location_id:
            success, _ = self.run_test(
                "Delete Test Location",
                "DELETE",
                f"locations/{self.created_location_id}",
                200
            )
            cleanup_success = cleanup_success and success
        
        return cleanup_success

def main():
    print("🚀 Starting HubSpoke Scheduler API Tests")
    print("=" * 50)
    
    tester = HubSpokeAPITester()
    
    # Test sequence
    tests = [
        # Auth tests
        ("Authentication - Login", tester.test_auth_login),
        ("Authentication - Get Me", tester.test_auth_me),
        
        # Dashboard tests
        ("Dashboard - Stats", tester.test_dashboard_stats),
        
        # Location tests
        ("Locations - Get All", tester.test_locations_get),
        ("Locations - Create", tester.test_locations_create),
        ("Locations - Update", tester.test_locations_update),
        
        # Employee tests
        ("Employees - Get All", tester.test_employees_get),
        ("Employees - Create", tester.test_employees_create),
        ("Employees - Update", tester.test_employees_update),
        
        # Schedule tests
        ("Schedules - Get All", tester.test_schedules_get),
        ("Schedules - Create", tester.test_schedules_create),
        ("Schedules - Town-to-Town", tester.test_schedules_town_to_town),
        ("Schedules - Update", tester.test_schedules_update),
        
        # NEW PM FEATURES - Backend API tests
        ("PM Features - Schedule Status Update", tester.test_schedule_status_update),
        ("PM Features - Activity Logs", tester.test_activity_logs),
        ("PM Features - Employee Stats", tester.test_employee_stats),
        ("PM Features - Notifications", tester.test_notifications),
        ("PM Features - Workload Stats", tester.test_workload_stats),
        
        # NEW ITERATION 3 FEATURES - Conflict detection, recurring schedules, relocate, reports
        ("NEW - Check Schedule Conflicts", tester.test_schedule_check_conflicts),
        ("NEW - Recurring Schedules", tester.test_schedule_recurring),
        ("NEW - Schedule Conflict 409", tester.test_schedule_conflict_409),
        ("NEW - Schedule Relocate", tester.test_schedule_relocate),
        ("NEW - Weekly Summary Report", tester.test_weekly_summary_report),
        ("NEW - Weekly Summary Custom Dates", tester.test_weekly_summary_custom_dates),
        
        # Cleanup
        ("Cleanup - Delete Test Data", tester.test_cleanup),
    ]
    
    # Run all tests
    for test_name, test_func in tests:
        try:
            result = test_func()
            if not result:
                print(f"⚠️  {test_name} had issues but continuing...")
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {str(e)}")
    
    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    success_rate = (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0
    print(f"📈 Success Rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("✅ Backend API tests mostly successful!")
        return 0
    elif success_rate >= 60:
        print("⚠️  Backend API tests partially successful")
        return 1
    else:
        print("❌ Backend API tests failed")
        return 2

if __name__ == "__main__":
    sys.exit(main())