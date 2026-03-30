import pytest
import requests

class TestUsers:
    """User and contact management tests"""

    def test_list_users(self, api_client, base_url, admin_token):
        """Test GET /api/users"""
        print("\n=== Testing List Users ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/users")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "users" in data
        assert isinstance(data["users"], list)
        assert len(data["users"]) >= 1  # At least test user
        print(f"✓ Found {len(data['users'])} users")

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
            print(f"✓ User retrieved: {data['user']['name']}")
        else:
            pytest.skip("No users available for testing")

class TestContacts:
    """Contact management tests"""

    def test_add_contact_and_verify(self, api_client, base_url, admin_token):
        """Test adding a contact and verifying it appears in contacts list"""
        print("\n=== Testing Add Contact ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get list of users to find someone to add
        users_response = api_client.get(f"{base_url}/api/users")
        users = users_response.json()["users"]
        
        if len(users) == 0:
            pytest.skip("No users available to add as contact")
        
        target_user = users[0]
        
        # Add contact
        add_response = api_client.post(f"{base_url}/api/contacts/add", json={
            "user_id": target_user["id"],
            "trust_level": "VERIFIED"
        })
        print(f"Add Status: {add_response.status_code}")
        
        # Should succeed or already exist
        assert add_response.status_code in [200, 400]
        
        if add_response.status_code == 200:
            print(f"✓ Contact added: {target_user['name']}")
        else:
            print(f"✓ Contact already exists: {target_user['name']}")
        
        # Verify contact appears in list
        contacts_response = api_client.get(f"{base_url}/api/contacts")
        print(f"List Status: {contacts_response.status_code}")
        
        assert contacts_response.status_code == 200
        contacts_data = contacts_response.json()
        assert "contacts" in contacts_data
        
        contact_ids = [c["id"] for c in contacts_data["contacts"]]
        assert target_user["id"] in contact_ids, "Added contact not found in contacts list"
        print(f"✓ Contact verified in list ({len(contacts_data['contacts'])} total contacts)")

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
        
        update_data = {
            "status_text": "Testing in progress"
        }
        
        response = api_client.put(f"{base_url}/api/profile", json=update_data)
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "user" in data
        assert data["user"]["status_text"] == update_data["status_text"]
        print(f"✓ Profile updated: {data['user']['status_text']}")
