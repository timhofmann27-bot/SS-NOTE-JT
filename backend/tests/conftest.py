import pytest
import requests
import os


def get_backend_url():
    """Get backend URL from environment or .env files"""
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env", "r") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except:
            pass
    if not url:
        try:
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(backend_dir)
            env_path = os.path.join(project_root, "frontend", ".env")
            with open(env_path, "r") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except:
            pass
    return url


@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def base_url():
    """Base URL from environment"""
    url = get_backend_url()
    if not url:
        pytest.skip(
            "EXPO_PUBLIC_BACKEND_URL not configured - skipping integration tests"
        )
    return url.rstrip("/")


@pytest.fixture
def admin_credentials():
    """Admin login credentials (ANONYMOUS AUTH)"""
    return {"username": "wolf-1", "passkey": "Funk2024!"}


@pytest.fixture
def test_user_credentials():
    """Test user login credentials (ANONYMOUS AUTH)"""
    return {"username": "adler-2", "passkey": "Funk2024!"}


@pytest.fixture
def admin_token(api_client, base_url, admin_credentials):
    """Get admin auth token"""
    response = api_client.post(f"{base_url}/api/auth/login", json=admin_credentials)
    if response.status_code == 200:
        return response.json().get("token")
    return None


@pytest.fixture
def test_user_token(api_client, base_url, test_user_credentials):
    """Get test user auth token"""
    response = api_client.post(f"{base_url}/api/auth/login", json=test_user_credentials)
    if response.status_code == 200:
        return response.json().get("token")
    return None
