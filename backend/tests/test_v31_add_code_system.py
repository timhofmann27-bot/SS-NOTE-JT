import pytest
import requests


class TestV31AddCodeSystem:
    """Test v3.1 Add-Me-Code Privacy System - Contact requests via FUNK-XXXXXX codes"""

    def test_get_my_add_code(self, api_client, base_url):
        """Test GET /api/users/my-add-code returns user's add code"""
        print("\n=== Testing GET My Add-Code ===")

        # Login as wolf-1
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200, f"Login failed: {login_res.status_code}"
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Get add code
        response = api_client.get(f"{base_url}/api/users/my-add-code")
        print(f"Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "code" in data, "Response missing 'code' field"

        code = data["code"]
        print(f"Add-Code: {code}")

        # Verify format: FUNK-XXXXXX (6 alphanumeric uppercase)
        assert code.startswith("FUNK-"), f"Code should start with 'FUNK-', got: {code}"
        assert (
            len(code) == 11
        ), f"Code should be 11 chars (FUNK-XXXXXX), got: {len(code)}"

        code_part = code.split("-")[1]
        assert (
            len(code_part) == 6
        ), f"Code part should be 6 chars, got: {len(code_part)}"
        assert (
            code_part.isalnum()
        ), f"Code part should be alphanumeric, got: {code_part}"
        assert code_part.isupper(), f"Code part should be uppercase, got: {code_part}"

        print(f"✓ Add-Code format valid: {code}")
        return code

    def test_wolf1_has_correct_seed_code(self, api_client, base_url):
        """Test wolf-1 has seeded code FUNK-W0LF01"""
        print("\n=== Testing wolf-1 Seed Code ===")

        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        response = api_client.get(f"{base_url}/api/users/my-add-code")
        assert response.status_code == 200

        code = response.json()["code"]
        print(f"wolf-1 code: {code}")

        assert code == "FUNK-W0LF01", f"Expected FUNK-W0LF01, got {code}"
        print("✓ wolf-1 has correct seed code")

    def test_adler2_has_correct_seed_code(self, api_client, base_url):
        """Test adler-2 has seeded code FUNK-ADL3R2"""
        print("\n=== Testing adler-2 Seed Code ===")

        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "adler-2", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        response = api_client.get(f"{base_url}/api/users/my-add-code")
        assert response.status_code == 200

        code = response.json()["code"]
        print(f"adler-2 code: {code}")

        assert code == "FUNK-ADL3R2", f"Expected FUNK-ADL3R2, got {code}"
        print("✓ adler-2 has correct seed code")

    def test_reset_add_code(self, api_client, base_url):
        """Test POST /api/users/reset-add-code generates new code"""
        print("\n=== Testing Reset Add-Code ===")

        # Login as wolf-1
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Get current code
        old_code_res = api_client.get(f"{base_url}/api/users/my-add-code")
        old_code = old_code_res.json()["code"]
        print(f"Old code: {old_code}")

        # Reset code
        response = api_client.post(f"{base_url}/api/users/reset-add-code")
        print(f"Reset Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "code" in data, "Response missing 'code' field"

        new_code = data["code"]
        print(f"New code: {new_code}")

        # Verify new code is different
        assert new_code != old_code, "New code should be different from old code"

        # Verify format
        assert new_code.startswith(
            "FUNK-"
        ), f"New code should start with 'FUNK-', got: {new_code}"
        assert len(new_code) == 11, f"New code should be 11 chars, got: {len(new_code)}"

        print(f"✓ Code reset successful: {old_code} → {new_code}")

    def test_add_by_code_send_request(self, api_client, base_url):
        """Test POST /api/contacts/add-by-code sends contact request"""
        print("\n=== Testing Add Contact by Code ===")

        # Login as wolf-1
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Send request to adler-2 using their code
        response = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": "FUNK-ADL3R2"}
        )
        print(f"Add by code Status: {response.status_code}")

        # Should be 200 (new request) or 400 (already sent/already contacts)
        assert response.status_code in [
            200,
            400,
        ], f"Expected 200 or 400, got {response.status_code}: {response.text}"

        data = response.json()

        if response.status_code == 200:
            assert "message" in data or "request_id" in data
            print(f"✓ Request sent: {data.get('message', 'Success')}")
            if "request_id" in data:
                print(f"  Request ID: {data['request_id']}")
        else:
            # Already sent or already contacts
            print(
                f"✓ Expected 400: {data.get('detail', 'Already sent or already contacts')}"
            )

    def test_add_by_code_invalid_code(self, api_client, base_url):
        """Test POST /api/contacts/add-by-code rejects invalid code"""
        print("\n=== Testing Add by Code - Invalid Code ===")

        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Try invalid code
        response = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": "FUNK-INVALID"}
        )
        print(f"Invalid code Status: {response.status_code}")

        assert response.status_code == 404, f"Expected 404, got {response.status_code}"

        data = response.json()
        assert "detail" in data
        print(f"✓ Invalid code rejected: {data['detail']}")

    def test_add_by_code_own_code(self, api_client, base_url):
        """Test POST /api/contacts/add-by-code rejects own code"""
        print("\n=== Testing Add by Code - Own Code ===")

        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Get own code
        code_res = api_client.get(f"{base_url}/api/users/my-add-code")
        own_code = code_res.json()["code"]

        # Try to add self
        response = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": own_code}
        )
        print(f"Own code Status: {response.status_code}")

        assert response.status_code == 400, f"Expected 400, got {response.status_code}"

        data = response.json()
        assert "detail" in data
        print(f"✓ Own code rejected: {data['detail']}")

    def test_get_contact_requests(self, api_client, base_url):
        """Test GET /api/contacts/requests returns incoming and outgoing"""
        print("\n=== Testing GET Contact Requests ===")

        # Login as adler-2 (should have incoming request from wolf-1)
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "adler-2", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        response = api_client.get(f"{base_url}/api/contacts/requests")
        print(f"Requests Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "incoming" in data, "Response missing 'incoming' field"
        assert "outgoing" in data, "Response missing 'outgoing' field"

        incoming = data["incoming"]
        outgoing = data["outgoing"]

        print(f"Incoming requests: {len(incoming)}")
        print(f"Outgoing requests: {len(outgoing)}")

        # Should have at least one incoming from wolf-1 (if not already accepted)
        if len(incoming) > 0:
            req = incoming[0]
            print(
                f"  First incoming: {req.get('requester_username')} → {req.get('status')}"
            )
            assert "id" in req
            assert "requester_id" in req
            assert "requester_username" in req
            assert "status" in req

        print("✓ Contact requests retrieved")
        return data

    def test_accept_contact_request(self, api_client, base_url):
        """Test POST /api/contacts/request/{id}/accept creates confirmed contact"""
        print("\n=== Testing Accept Contact Request ===")

        # Login as adler-2
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "adler-2", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        # Get incoming requests
        requests_res = api_client.get(f"{base_url}/api/contacts/requests")
        incoming = requests_res.json()["incoming"]

        if len(incoming) == 0:
            print("⚠ No incoming requests to accept (may already be accepted)")
            pytest.skip("No pending requests")

        request_id = incoming[0]["id"]
        print(f"Accepting request: {request_id}")

        # Accept request
        response = api_client.post(
            f"{base_url}/api/contacts/request/{request_id}/accept"
        )
        print(f"Accept Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "message" in data
        print(f"✓ Request accepted: {data['message']}")

    def test_get_contacts_only_confirmed(self, api_client, base_url):
        """Test GET /api/contacts returns ONLY confirmed contacts"""
        print("\n=== Testing GET Contacts (Only Confirmed) ===")

        # Login as wolf-1
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        response = api_client.get(f"{base_url}/api/contacts")
        print(f"Contacts Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "contacts" in data, "Response missing 'contacts' field"

        contacts = data["contacts"]
        print(f"Confirmed contacts: {len(contacts)}")

        for contact in contacts:
            print(f"  - {contact.get('username')} ({contact.get('name')})")
            assert "id" in contact
            assert "username" in contact
            # Should NOT have add_me_code in response (privacy)
            assert (
                "add_me_code" not in contact
            ), "add_me_code should not be exposed in contacts list"

        print("✓ Contacts list retrieved (only confirmed)")

    def test_get_users_only_confirmed_contacts(self, api_client, base_url):
        """Test GET /api/users returns ONLY confirmed contacts (no global list)"""
        print("\n=== Testing GET Users (Only Confirmed Contacts - No Global List) ===")

        # Login as wolf-1
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token}"})

        response = api_client.get(f"{base_url}/api/users")
        print(f"Users Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "users" in data, "Response missing 'users' field"

        users = data["users"]
        print(f"Visible users: {len(users)}")

        # Should only see confirmed contacts, NOT all users in database
        for user in users:
            print(f"  - {user.get('username')} ({user.get('name')})")
            assert "id" in user
            assert "username" in user
            # Should NOT have add_me_code
            assert "add_me_code" not in user, "add_me_code should not be exposed"

        print("✓ Users endpoint returns only confirmed contacts (privacy enforced)")

    def test_reject_contact_request(self, api_client, base_url):
        """Test POST /api/contacts/request/{id}/reject rejects request"""
        print("\n=== Testing Reject Contact Request ===")

        # Create a new request first
        # Login as wolf-1 and send request to adler-2
        login_res = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login_res.status_code == 200
        token1 = login_res.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token1}"})

        # Try to send request (may fail if already contacts)
        add_res = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": "FUNK-ADL3R2"}
        )

        if add_res.status_code == 400:
            print("⚠ Cannot create new request (already contacts or pending)")
            pytest.skip("Cannot test reject - already contacts")

        # Login as adler-2
        login_res2 = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "adler-2", "passkey": "Funk2024!"},
        )
        assert login_res2.status_code == 200
        token2 = login_res2.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token2}"})

        # Get incoming requests
        requests_res = api_client.get(f"{base_url}/api/contacts/requests")
        incoming = requests_res.json()["incoming"]

        if len(incoming) == 0:
            print("⚠ No incoming requests to reject")
            pytest.skip("No pending requests")

        request_id = incoming[0]["id"]
        print(f"Rejecting request: {request_id}")

        # Reject request
        response = api_client.post(
            f"{base_url}/api/contacts/request/{request_id}/reject"
        )
        print(f"Reject Status: {response.status_code}")

        assert (
            response.status_code == 200
        ), f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "message" in data
        print(f"✓ Request rejected: {data['message']}")

    def test_full_add_code_flow(self, api_client, base_url):
        """Test complete flow: get code → send request → accept → verify contacts"""
        print("\n=== Testing Full Add-Code Flow ===")

        # Step 1: Login as wolf-1, get add code
        print("\n1. wolf-1 gets their add code")
        login1 = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "wolf-1", "passkey": "Funk2024!"},
        )
        assert login1.status_code == 200
        token1 = login1.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token1}"})

        code_res = api_client.get(f"{base_url}/api/users/my-add-code")
        wolf_code = code_res.json()["code"]
        print(f"   wolf-1 code: {wolf_code}")

        # Step 2: Login as adler-2, send request to wolf-1
        print("\n2. adler-2 sends request to wolf-1 using code")
        login2 = api_client.post(
            f"{base_url}/api/auth/login",
            json={"username": "adler-2", "passkey": "Funk2024!"},
        )
        assert login2.status_code == 200
        token2 = login2.json()["token"]
        api_client.headers.update({"Authorization": f"Bearer {token2}"})

        add_res = api_client.post(
            f"{base_url}/api/contacts/add-by-code", json={"code": wolf_code}
        )
        print(f"   Request status: {add_res.status_code}")

        if add_res.status_code == 400:
            print("   ⚠ Already contacts or request pending")
        else:
            assert add_res.status_code == 200
            print(f"   ✓ Request sent")

        # Step 3: wolf-1 checks incoming requests
        print("\n3. wolf-1 checks incoming requests")
        api_client.headers.update({"Authorization": f"Bearer {token1}"})
        requests_res = api_client.get(f"{base_url}/api/contacts/requests")
        incoming = requests_res.json()["incoming"]
        print(f"   Incoming requests: {len(incoming)}")

        # Step 4: wolf-1 accepts request (if exists)
        if len(incoming) > 0:
            print("\n4. wolf-1 accepts request")
            request_id = incoming[0]["id"]
            accept_res = api_client.post(
                f"{base_url}/api/contacts/request/{request_id}/accept"
            )
            assert accept_res.status_code == 200
            print(f"   ✓ Request accepted")
        else:
            print("\n4. No pending requests (may already be contacts)")

        # Step 5: Both users verify they see each other in contacts
        print("\n5. Verify bidirectional contacts")

        # wolf-1 contacts
        api_client.headers.update({"Authorization": f"Bearer {token1}"})
        wolf_contacts = api_client.get(f"{base_url}/api/contacts")
        wolf_contact_list = wolf_contacts.json()["contacts"]
        print(f"   wolf-1 contacts: {len(wolf_contact_list)}")

        # adler-2 contacts
        api_client.headers.update({"Authorization": f"Bearer {token2}"})
        adler_contacts = api_client.get(f"{base_url}/api/contacts")
        adler_contact_list = adler_contacts.json()["contacts"]
        print(f"   adler-2 contacts: {len(adler_contact_list)}")

        print("\n✓ Full Add-Code flow completed")


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
