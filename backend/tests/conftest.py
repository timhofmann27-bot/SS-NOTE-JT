import pytest
import requests
import os

@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture
def base_url():
    """Base URL from environment"""
    # Read from frontend .env since tests run from backend
    url = os.environ.get('EXPO_PUBLIC_BACKEND_URL')
    if not url:
        # Fallback: read from frontend .env file
        try:
            with open('/app/frontend/.env', 'r') as f:
                for line in f:
                    if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                        url = line.split('=', 1)[1].strip()
                        break
        except:
            pass
    if not url:
        raise ValueError("EXPO_PUBLIC_BACKEND_URL not found in environment or /app/frontend/.env")
    return url.rstrip('/')

@pytest.fixture
def admin_credentials():
    """Admin login credentials"""
    return {
        "email": "kommandant@heimatfunk.de",
        "password": "Funk2024!"
    }

@pytest.fixture
def test_user_credentials():
    """Test user login credentials"""
    return {
        "email": "funker@heimatfunk.de",
        "password": "Funk2024!"
    }

@pytest.fixture
def admin_token(api_client, base_url, admin_credentials):
    """Get admin auth token"""
    response = api_client.post(f"{base_url}/api/auth/login", json=admin_credentials)
    if response.status_code == 200:
        return response.json().get('token')
    return None

@pytest.fixture
def test_user_token(api_client, base_url, test_user_credentials):
    """Get test user auth token"""
    response = api_client.post(f"{base_url}/api/auth/login", json=test_user_credentials)
    if response.status_code == 200:
        return response.json().get('token')
    return None
