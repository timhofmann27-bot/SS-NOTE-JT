import pytest
import requests


class TestUsers:
    """User and contact management tests"""

    def test_list_users(self, api_client, base_url, admin_token, test_user_token):
        """Test GET /api/users - returns only confirmed contacts"""
        print("\n=== Testing List Users (Confirmed Contacts Only) ===")

        # First, send a contact request from admin to test user using add-by-code
        # Get test user's add code
        test_client = requests.Session()
        test_client.headers.update(
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {test_user_token}",
            }
        )
        code_response = test_client.get(f"{base_url}/api/contacts/my-add-code")

        if code_response.status_code == 200:
            add_code = code_response.json().get("add_me_code")
            if add_code:
                # Admin sends contact request
                api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
                add_response = api_client.post(
                    f"{base_url}/api/contacts/add-by-code", json={"code": add_code}
                )
                print(f"Add-by-code Status: {add_response.status_code}")

                # Test user accepts the request
                if add_response.status_code in [200, 201]:
                    requests_response = test_client.get(
                        f"{base_url}/api/contacts/requests"
                    )
                    if requests_response.status_code == 200:
                        reqs = requests_response.json().get("requests", [])
                        if reqs:
                            req_id = reqs[0]["id"]
                            accept_response = test_client.post(
                                f"{base_url}/api/contacts/requests/{req_id}/accept"
                            )
                            print(f"Accept Status: {accept_response.status_code}")

        # Now check the users list (should have at least 1 confirmed contact)
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/users")
        print(f"Status: {response.status_code}")

        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        assert isinstance(data["users"], list)

        # Verify no email field in users
        for user in data["users"]:
            assert "email" not in user, "Email field should not exist in anonymous auth"
            assert "username" in user, "Username field missing"

        print(
            f"✓ Found {len(data['users'])} confirmed contacts (all without email field)"
        )

    def test_get_user_by_id(self, api_client, base_url, admin_token):
        """Test GET /api/users/{id}"""
        print("\n=== Testing Get User by ID ===")

        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        # First get list of users
        users_response = api_client.get(f"{base_url}/api/users")
        users = users_response.json()["users"]

        if len(users) > 0:
            user_id = users[0]["id"]
            response = api_client.get(f"{base_url}/api/users/{user_id}")
            print(f"Status: {response.status_code}")

            assert response.status_code == 200
            data = response.json()
            assert "user" in data
            assert data["user"]["id"] == user_id
            assert "email" not in data["user"], "Email field should not exist"
            assert "username" in data["user"], "Username field missing"
            print(
                f"✓ User retrieved: {data['user']['name']} (@{data['user']['username']})"
            )
        else:
            pytest.skip("No users available for testing")


class TestContacts:
    """Contact management tests"""

    def test_add_contact_and_verify(
        self, api_client, base_url, admin_token, test_user_token
    ):
        """Test adding a contact via add-by-code and verifying it appears in contacts list"""
        print("\n=== Testing Add Contact ===")

        # Get test user's add code
        test_client = requests.Session()
        test_client.headers.update(
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {test_user_token}",
            }
        )
        code_response = test_client.get(f"{base_url}/api/contacts/my-add-code")

        if code_response.status_code != 200:
            pytest.skip("Could not get add code")

        add_code = code_response.json().get("add_me_code")
        if not add_code:
            pytest.skip("No add code available")

        # Admin sends contact request using add-by-code
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        add_response = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": add_code}
        )
        print(f"Add-by-code Status: {add_response.status_code}")

        # Should succeed or already exist (400 means already sent/requested)
        assert add_response.status_code in [
            200,
            201,
            400,
        ], f"Unexpected status: {add_response.status_code}"
        print(f"✓ Contact request sent or already exists")

        # Test user accepts the request
        requests_response = test_client.get(f"{base_url}/api/contacts/requests")
        if requests_response.status_code == 200:
            reqs = requests_response.json().get("requests", [])
            if reqs:
                req_id = reqs[0]["id"]
                accept_response = test_client.post(
                    f"{base_url}/api/contacts/requests/{req_id}/accept"
                )
                print(f"Accept Status: {accept_response.status_code}")

        # Verify contact appears in list
        contacts_response = api_client.get(f"{base_url}/api/contacts")
        print(f"List Status: {contacts_response.status_code}")

        assert contacts_response.status_code == 200
        contacts_data = contacts_response.json()
        assert "contacts" in contacts_data
        assert len(contacts_data["contacts"]) >= 1
        print(f"✓ Found {len(contacts_data['contacts'])} contacts")

    def test_list_contacts(self, api_client, base_url, admin_token):
        """Test GET /api/contacts"""
        print("\n=== Testing List Contacts ===")

        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/contacts")
        print(f"Status: {response.status_code}")

        assert response.status_code == 200
        data = response.json()
        assert "contacts" in data
        assert isinstance(data["contacts"], list)
        print(f"✓ Found {len(data['contacts'])} contacts")

    def test_update_profile(self, api_client, base_url, admin_token):
        """Test PUT /api/profile"""
        print("\n=== Testing Update Profile ===")

        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})

        update_data = {"status_text": "Testing in progress"}

        response = api_client.put(f"{base_url}/api/profile", json=update_data)
        print(f"Status: {response.status_code}")

        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert data["user"]["status_text"] == update_data["status_text"]
        print(f"✓ Profile updated: {data['user']['status_text']}")
