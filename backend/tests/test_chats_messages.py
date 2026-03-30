import pytest
import requests
import time

class TestChats:
    """Chat management tests"""

    def test_create_1on1_chat_and_verify(self, api_client, base_url, admin_token):
        """Test creating a 1:1 chat and verifying it appears in chat list"""
        print("\n=== Testing Create 1:1 Chat ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get a user to chat with
        users_response = api_client.get(f"{base_url}/api/users")
        users = users_response.json()["users"]
        
        if len(users) == 0:
            pytest.skip("No users available to create chat")
        
        target_user = users[0]
        
        # Create chat
        create_response = api_client.post(f"{base_url}/api/chats", json={
            "participant_ids": [target_user["id"]],
            "is_group": False,
            "security_level": "UNCLASSIFIED"
        })
        print(f"Create Status: {create_response.status_code}")
        
        assert create_response.status_code == 200
        chat_data = create_response.json()
        assert "chat" in chat_data
        assert chat_data["chat"]["is_group"] == False
        
        chat_id = chat_data["chat"]["id"]
        print(f"✓ Chat created: {chat_id}")
        
        # Verify chat appears in list
        list_response = api_client.get(f"{base_url}/api/chats")
        print(f"List Status: {list_response.status_code}")
        
        assert list_response.status_code == 200
        chats = list_response.json()["chats"]
        chat_ids = [c["id"] for c in chats]
        assert chat_id in chat_ids, "Created chat not found in chat list"
        print(f"✓ Chat verified in list ({len(chats)} total chats)")
        
        return chat_id

    def test_list_chats(self, api_client, base_url, admin_token):
        """Test GET /api/chats"""
        print("\n=== Testing List Chats ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        response = api_client.get(f"{base_url}/api/chats")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "chats" in data
        assert isinstance(data["chats"], list)
        print(f"✓ Found {len(data['chats'])} chats")

    def test_get_chat_by_id(self, api_client, base_url, admin_token):
        """Test GET /api/chats/{id}"""
        print("\n=== Testing Get Chat by ID ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get list of chats
        chats_response = api_client.get(f"{base_url}/api/chats")
        chats = chats_response.json()["chats"]
        
        if len(chats) == 0:
            pytest.skip("No chats available for testing")
        
        chat_id = chats[0]["id"]
        response = api_client.get(f"{base_url}/api/chats/{chat_id}")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "chat" in data
        assert data["chat"]["id"] == chat_id
        print(f"✓ Chat retrieved: {chat_id}")

    def test_create_group_chat(self, api_client, base_url, admin_token):
        """Test creating a group chat"""
        print("\n=== Testing Create Group Chat ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get users
        users_response = api_client.get(f"{base_url}/api/users")
        users = users_response.json()["users"]
        
        if len(users) == 0:
            pytest.skip("No users available to create group chat")
        
        participant_ids = [u["id"] for u in users[:2]]  # Take up to 2 users
        
        # Create group chat
        create_response = api_client.post(f"{base_url}/api/chats", json={
            "participant_ids": participant_ids,
            "is_group": True,
            "name": "Test Group",
            "security_level": "RESTRICTED"
        })
        print(f"Create Status: {create_response.status_code}")
        
        assert create_response.status_code == 200
        chat_data = create_response.json()
        assert "chat" in chat_data
        assert chat_data["chat"]["is_group"] == True
        assert chat_data["chat"]["name"] == "Test Group"
        print(f"✓ Group chat created: {chat_data['chat']['id']}")

class TestMessages:
    """Message management tests"""

    def test_send_message_and_verify(self, api_client, base_url, admin_token):
        """Test sending a message and verifying it appears in message list"""
        print("\n=== Testing Send Message ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get or create a chat
        chats_response = api_client.get(f"{base_url}/api/chats")
        chats = chats_response.json()["chats"]
        
        if len(chats) == 0:
            # Create a chat first
            users_response = api_client.get(f"{base_url}/api/users")
            users = users_response.json()["users"]
            if len(users) == 0:
                pytest.skip("No users available to create chat")
            
            create_response = api_client.post(f"{base_url}/api/chats", json={
                "participant_ids": [users[0]["id"]],
                "is_group": False
            })
            chat_id = create_response.json()["chat"]["id"]
        else:
            chat_id = chats[0]["id"]
        
        # Send message
        message_content = f"Test message at {time.time()}"
        send_response = api_client.post(f"{base_url}/api/messages", json={
            "chat_id": chat_id,
            "content": message_content,
            "message_type": "text",
            "security_level": "UNCLASSIFIED"
        })
        print(f"Send Status: {send_response.status_code}")
        
        assert send_response.status_code == 200
        message_data = send_response.json()
        assert "message" in message_data
        assert message_data["message"]["content"] == message_content
        assert message_data["message"]["chat_id"] == chat_id
        
        message_id = message_data["message"]["id"]
        print(f"✓ Message sent: {message_id}")
        
        # Verify message appears in chat messages
        messages_response = api_client.get(f"{base_url}/api/messages/{chat_id}")
        print(f"List Status: {messages_response.status_code}")
        
        assert messages_response.status_code == 200
        messages = messages_response.json()["messages"]
        message_ids = [m["id"] for m in messages]
        assert message_id in message_ids, "Sent message not found in messages list"
        print(f"✓ Message verified in list ({len(messages)} total messages)")

    def test_get_messages(self, api_client, base_url, admin_token):
        """Test GET /api/messages/{chat_id}"""
        print("\n=== Testing Get Messages ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get a chat
        chats_response = api_client.get(f"{base_url}/api/chats")
        chats = chats_response.json()["chats"]
        
        if len(chats) == 0:
            pytest.skip("No chats available for testing")
        
        chat_id = chats[0]["id"]
        response = api_client.get(f"{base_url}/api/messages/{chat_id}")
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert isinstance(data["messages"], list)
        print(f"✓ Found {len(data['messages'])} messages")

    def test_mark_messages_read(self, api_client, base_url, admin_token):
        """Test POST /api/messages/read"""
        print("\n=== Testing Mark Messages Read ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get a chat with messages
        chats_response = api_client.get(f"{base_url}/api/chats")
        chats = chats_response.json()["chats"]
        
        if len(chats) == 0:
            pytest.skip("No chats available for testing")
        
        chat_id = chats[0]["id"]
        messages_response = api_client.get(f"{base_url}/api/messages/{chat_id}")
        messages = messages_response.json()["messages"]
        
        if len(messages) == 0:
            pytest.skip("No messages available for testing")
        
        message_ids = [m["id"] for m in messages[:3]]  # Mark first 3 as read
        
        response = api_client.post(f"{base_url}/api/messages/read", json={
            "message_ids": message_ids
        })
        print(f"Status: {response.status_code}")
        
        assert response.status_code == 200
        print(f"✓ Marked {len(message_ids)} messages as read")

    def test_send_emergency_message(self, api_client, base_url, admin_token):
        """Test sending an emergency message"""
        print("\n=== Testing Emergency Message ===")
        
        api_client.headers.update({"Authorization": f"Bearer {admin_token}"})
        
        # Get a chat
        chats_response = api_client.get(f"{base_url}/api/chats")
        chats = chats_response.json()["chats"]
        
        if len(chats) == 0:
            pytest.skip("No chats available for testing")
        
        chat_id = chats[0]["id"]
        
        # Send emergency message
        send_response = api_client.post(f"{base_url}/api/messages", json={
            "chat_id": chat_id,
            "content": "EMERGENCY: Test alert",
            "message_type": "text",
            "security_level": "SECRET",
            "is_emergency": True
        })
        print(f"Status: {send_response.status_code}")
        
        assert send_response.status_code == 200
        message_data = send_response.json()
        assert message_data["message"]["is_emergency"] == True
        assert message_data["message"]["security_level"] == "SECRET"
        print(f"✓ Emergency message sent: {message_data['message']['id']}")
