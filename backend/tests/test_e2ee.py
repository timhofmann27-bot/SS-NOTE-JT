import pytest
import requests
import secrets


class TestE2EEKeyManagement:
    """E2EE public key management endpoints"""

    def test_upload_public_key(self, api_client, base_url):
        """Test uploading a public key"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"keyuser-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Key User",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        resp = api_client.post(
            f"{base_url}/api/keys/upload",
            json={
                "public_key": "dGVzdHB1YmxpY2tleQ==",
                "fingerprint": "AA:BB:CC:DD:EE:FF",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data

    def test_get_own_public_key(self, api_client, base_url):
        """Test retrieving own public key after upload"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"keyuser-b-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Key User B",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        api_client.post(
            f"{base_url}/api/keys/upload",
            json={
                "public_key": "dGVzdHB1YmxpY2tleWI=",
                "fingerprint": "11:22:33:44",
            },
        )

        me = api_client.get(f"{base_url}/api/auth/me")
        my_id = me.json()["user"]["id"]

        resp = api_client.get(f"{base_url}/api/keys/{my_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["public_key"] == "dGVzdHB1YmxpY2tleWI="
        assert data["fingerprint"] == "11:22:33:44"

    def test_get_nonexistent_key_returns_404(self, api_client, base_url):
        """Test that getting a key for a user without one returns 404"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"nokey-{unique_id}",
            "passkey": "TestPass123!",
            "name": "No Key User",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        me = api_client.get(f"{base_url}/api/auth/me")
        my_id = me.json()["user"]["id"]

        resp = api_client.get(f"{base_url}/api/keys/{my_id}")
        assert resp.status_code == 404


class TestE2EEEncryptedMessages:
    """E2EE encrypted message endpoints"""

    def test_send_encrypted_message(self, api_client, base_url):
        """Test sending an encrypted message"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-user-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Enc User",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": False,
            },
        )
        assert chat_resp.status_code == 200
        chat_id = chat_resp.json()["chat"]["id"]

        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "ZW5jcnlwdGVkY29udGVudA==",
                "nonce": "bm9uY2V2YWx1ZQ==",
                "dh_public": "ZGhwdWJsaWNrZXk=",
                "msg_num": 0,
                "security_level": "UNCLASSIFIED",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"]["encrypted"] is True
        assert data["message"]["e2ee"] is True
        assert data["message"]["content"] == "ZW5jcnlwdGVkY29udGVudA=="

    def test_encrypted_message_with_media(self, api_client, base_url):
        """Test sending an encrypted message with encrypted media attachment"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-media-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Media Enc User",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": False,
            },
        )
        chat_id = chat_resp.json()["chat"]["id"]

        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "ZW5jcnlwdGVkY29udGVudA==",
                "nonce": "bm9uY2V2YWx1ZQ==",
                "dh_public": "ZGhwdWJsaWNrZXk=",
                "msg_num": 0,
                "message_type": "image",
                "media_ciphertext": "ZW5jcnlwdGVkSW1hZ2VEYXRh",
                "media_nonce": "bWVkaWFub25jZQ==",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"]["encrypted"] is True
        assert data["message"]["e2ee"] is True
        assert data["message"]["media_ciphertext"] == "ZW5jcnlwdGVkSW1hZ2VEYXRh"
        assert data["message"]["media_nonce"] == "bWVkaWFub25jZQ=="
        assert data["message"]["message_type"] == "image"

    def test_encrypted_group_message_with_sender_key(self, api_client, base_url):
        """Test sending an encrypted group message with sender key info"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-group-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Group Enc User",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": True,
                "name": "Test Group",
            },
        )
        chat_id = chat_resp.json()["chat"]["id"]

        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "Z3JvdXBFbmNyeXB0ZWQ=",
                "nonce": "Z3JvdXBub25jZQ==",
                "sender_key_id": "sender-key-12345",
                "sender_key_iteration": 5,
                "message_type": "text",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"]["encrypted"] is True
        assert data["message"]["e2ee"] is True
        assert data["message"]["sender_key_id"] == "sender-key-12345"
        assert data["message"]["sender_key_iteration"] == 5

    def test_encrypted_message_requires_chat_access(self, api_client, base_url):
        """Test that sending encrypted message to a chat you're not in fails"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-user2-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Enc User 2",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        fake_chat_id = "507f191e810c19729de860ea"
        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": fake_chat_id,
                "ciphertext": "dGVzdA==",
                "nonce": "bm9uY2U=",
            },
        )
        assert resp.status_code == 404

    def test_invalid_base64_rejected(self, api_client, base_url):
        """Test that invalid base64 in encrypted message is rejected"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-user3-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Enc User 3",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": False,
            },
        )
        chat_id = chat_resp.json()["chat"]["id"]

        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "!!!invalid-base64!!!",
                "nonce": "bm9uY2U=",
            },
        )
        assert resp.status_code == 400

    def test_invalid_media_base64_rejected(self, api_client, base_url):
        """Test that invalid base64 in media ciphertext is rejected"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-user4-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Enc User 4",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": False,
            },
        )
        chat_id = chat_resp.json()["chat"]["id"]

        resp = api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "dmFsaWRjaXBoZXI=",
                "nonce": "bm9uY2U=",
                "media_ciphertext": "!!!invalid!!!",
            },
        )
        assert resp.status_code == 400

    def test_get_messages_returns_encrypted_content(self, api_client, base_url):
        """Test that GET /messages returns ciphertext for E2EE messages"""
        unique_id = secrets.token_hex(4)
        user_data = {
            "username": f"enc-user5-{unique_id}",
            "passkey": "TestPass123!",
            "name": "Enc User 5",
        }
        reg = api_client.post(f"{base_url}/api/auth/register", json=user_data)
        assert reg.status_code == 200
        token = reg.json()["token"]
        api_client.headers["Authorization"] = f"Bearer {token}"

        chat_resp = api_client.post(
            f"{base_url}/api/chats",
            json={
                "participant_ids": [],
                "is_group": False,
            },
        )
        chat_id = chat_resp.json()["chat"]["id"]

        api_client.post(
            f"{base_url}/api/messages/encrypted",
            json={
                "chat_id": chat_id,
                "ciphertext": "c2VjcmV0bWVzc2FnZQ==",
                "nonce": "bm9uY2V2YWx1ZQ==",
                "dh_public": "ZGhwdWJsaWNrZXk=",
                "msg_num": 0,
            },
        )

        msgs = api_client.get(f"{base_url}/api/messages/{chat_id}")
        assert msgs.status_code == 200
        messages = msgs.json()["messages"]
        assert len(messages) >= 1
        assert messages[0]["e2ee"] is True
        assert messages[0]["encrypted"] is True
