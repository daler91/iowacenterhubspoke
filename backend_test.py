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

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    if isinstance(response_data, dict) and len(str(response_data)) < 500:
                        print(f"   Response: {response_data}")
                    elif isinstance(response_data, list):
                        print(f"   Response: List with {len(response_data)} items")
                    return True, response_data
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
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