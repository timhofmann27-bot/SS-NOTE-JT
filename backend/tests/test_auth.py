import pytest
import requests
import secrets


class TestAuth:
    """Authentication endpoint tests (ANONYMOUS AUTH: username + passkey)"""

    def test_login_admin_success(self, api_client, base_url, admin_credentials):
        """Test admin login with correct credentials"""
        print("\n=== Testing Admin Login (wolf-1) ===")
        response = api_client.post(f"{base_url}/api/auth/login", json=admin_credentials)
        print(f"Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "token" in data, "Response missing 'token' field"
        assert "user" in data, "Response missing 'user' field"
        assert data["user"]["username"] == admin_credentials["username"]
        assert data["user"]["role"] == "commander"
        assert (
            "email" not in data["user"]
        ), "Email field should not exist in anonymous auth"
        print(
            f"✓ Admin login successful: {data['user']['name']} (@{data['user']['username']})"
        )

    def test_login_test_user_success(self, api_client, base_url, test_user_credentials):
        """Test user login with correct credentials"""
        print("\n=== Testing Test User Login (adler-2) ===")
        response = api_client.post(
            f"{base_url}/api/auth/login", json=test_user_credentials
        )
        print(f"Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["username"] == test_user_credentials["username"]
        assert data["user"]["role"] == "officer"
        assert (
            "email" not in data["user"]
        ), "Email field should not exist in anonymous auth"
        print(
            f"✓ Test user login successful: {data['user']['name']} (@{data['user']['username']})"
        )

    def test_login_invalid_credentials(self, api_client, base_url):
        """Test login with invalid credentials"""
        print("\n=== Testing Invalid Login ===")
        response = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "invalid-user", "passkey": "wrongpassword"},
        )
        print(f"Status: {response.status_code}")

        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ Invalid credentials rejected correctly")

    def test_register_new_user(self, api_client, base_url):
        """Test user registration and verify persistence"""
        print("\n=== Testing User Registration (Anonymous) ===")

        # Generate unique username
        unique_id = secrets.token_hex(4)
        new_user = {
            "username": f"test-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Test Soldier",
            "callsign": "TEST-1",
        }

        # Register
        response = api_client.post(f"{base_url}/api/auth/register", json=new_user)
        print(f"Register Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["username"] == new_user["username"]
        assert data["user"]["name"] == new_user["name"]
        assert data["user"]["callsign"] == new_user["callsign"]
        assert data["user"]["role"] == "soldier"
        assert (
            "email" not in data["user"]
        ), "Email field should not exist in anonymous auth"

        token = data["token"]
        print(
            f"✓ User registered: @{data['user']['username']} ({data['user']['name']})"
        )

        # Verify persistence with /api/auth/me
        api_client.headers.update({"Authorization": f"Bearer {token}"})
        me_response = api_client.get(f"{base_url}/api/auth/me")
        print(f"Me Status: {me_response.status_code}")

        assert me_response.status_code == 200
        me_data = me_response.json()
        assert me_data["user"]["username"] == new_user["username"]
        assert "email" not in me_data["user"], "Email field should not exist"
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
        assert data["user"]["username"] == "wolf-1"
        assert "email" not in data["user"], "Email field should not exist"
        print(
            f"✓ User info retrieved: {data['user']['name']} (@{data['user']['username']})"
        )

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

    def test_change_passkey(self, api_client, base_url):
        """Test passkey change endpoint"""
        print("\n=== Testing Change Passkey ===")

        # Create a test user first
        unique_id = secrets.token_hex(4)
        new_user = {
            "username": f"passkey-test-{unique_id}",
            "passkey": "OldPass123!",
            "name": "Passkey Test User",
        }

        reg_response = api_client.post(f"{base_url}/api/auth/register", json=new_user)
        assert reg_response.status_code == 200
        token = reg_response.json()["token"]

        # Change passkey
        api_client.headers.update({"Authorization": f"Bearer {token}"})
        change_response = api_client.post(
            f"{base_url}/api/auth/change-passkey",
            json={"old_passkey": "OldPass123!", "new_passkey": "NewPass456!"},
        )
        print(f"Change Status: {change_response.status_code}")

        assert change_response.status_code == 200
        print("✓ Passkey changed successfully")

        # Verify new passkey works
        login_response = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": new_user["username"], "passkey": "NewPass456!"},
        )
        assert login_response.status_code == 200
        print("✓ New passkey works for login")

    def test_users_endpoint_no_email(self, api_client, base_url, admin_token):
        """Test that GET /api/users does not return email field"""
        print("\n=== Testing GET /api/users (no email field) ===")

        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/users")
        print(f"Status: {response.status_code}")

        assert response.status_code == 200
        data = response.json()
        assert "users" in data

        for user in data["users"]:
            assert (
                "email" not in user
            ), f"User {user.get('username')} has email field (should not exist)"
            assert "username" in user, "Username field missing"

        print(f"✓ All {len(data['users'])} users have no email field")
