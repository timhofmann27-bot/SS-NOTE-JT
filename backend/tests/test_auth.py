import pytest
import requests
import secrets

class TestAuth:
    """Authentication endpoint tests"""

    def test_login_admin_success(self, api_client, base_url, admin_credentials):
        """Test admin login with correct credentials"""
        print("\n=== Testing Admin Login ===")
        response = api_client.post(f"{base_url}/api/auth/login", json=admin_credentials)
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data, "Response missing 'token' field"
        assert "user" in data, "Response missing 'user' field"
        assert data["user"]["email"] == admin_credentials["email"]
        assert data["user"]["role"] == "commander"
        print(f"✓ Admin login successful: {data['user']['name']}")

    def test_login_test_user_success(self, api_client, base_url, test_user_credentials):
        """Test user login with correct credentials"""
        print("\n=== Testing Test User Login ===")
        response = api_client.post(f"{base_url}/api/auth/login", json=test_user_credentials)
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == test_user_credentials["email"]
        assert data["user"]["role"] == "officer"
        print(f"✓ Test user login successful: {data['user']['name']}")

    def test_login_invalid_credentials(self, api_client, base_url):
        """Test login with invalid credentials"""
        print("\n=== Testing Invalid Login ===")
        response = api_client.post(f"{base_url}/api/auth/login", json={
            "email": "invalid@heimatfunk.de",
            "password": "wrongpassword"
        })
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ Invalid credentials rejected correctly")

    def test_register_new_user(self, api_client, base_url):
        """Test user registration and verify persistence"""
        print("\n=== Testing User Registration ===")
        
        # Generate unique email
        unique_id = secrets.token_hex(4)
        new_user = {
            "email": f"test_{unique_id}@heimatfunk.de",
            "password": "TestPass123!",
            "name": "Test Soldier",
            "callsign": "TEST-1"
        }
        
        # Register
        response = api_client.post(f"{base_url}/api/auth/register", json=new_user)
        print(f"Register Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == new_user["email"]
        assert data["user"]["name"] == new_user["name"]
        assert data["user"]["callsign"] == new_user["callsign"]
        assert data["user"]["role"] == "soldier"
        
        token = data["token"]
        print(f"✓ User registered: {data['user']['email']}")
        
        # Verify persistence with /api/auth/me
        api_client.headers.update({"Authorization": f"Bearer {token}"})
        me_response = api_client.get(f"{base_url}/api/auth/me")
        print(f"Me Status: {me_response.status_code}")
        
        assert me_response.status_code == 200
        me_data = me_response.json()
        assert me_data["user"]["email"] == new_user["email"]
        print("✓ User data persisted correctly")

    def test_get_me_authenticated(self, api_client, base_url, admin_token):
        """Test /api/auth/me with valid token"""
        print("\n=== Testing GET /api/auth/me ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/auth/me")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert data["user"]["email"] == "kommandant@heimatfunk.de"
        print(f"✓ User info retrieved: {data['user']['name']}")

    def test_get_me_unauthenticated(self, api_client, base_url):
        """Test /api/auth/me without token"""
        print("\n=== Testing GET /api/auth/me (no token) ===")
        
        response = api_client.get(f"{base_url}/api/auth/me")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 401
        print("✓ Unauthenticated request rejected")

    def test_logout(self, api_client, base_url, admin_token):
        """Test logout endpoint"""
        print("\n=== Testing Logout ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.post(f"{base_url}/api/auth/logout")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        print("✓ Logout successful")
