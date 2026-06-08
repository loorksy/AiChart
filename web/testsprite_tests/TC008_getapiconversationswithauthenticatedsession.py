import requests

BASE_URL = "http://localhost:3000"
LOGIN_URL = f"{BASE_URL}/api/auth/login"
CONVERSATIONS_URL = f"{BASE_URL}/api/conversations"
TIMEOUT = 30

def test_get_api_conversations_with_authenticated_session():
    session = requests.Session()
    try:
        # Login with provided credentials to obtain authenticated session (JWT cookie)
        login_payload = {
            "email": "admin@aichart.local",
            "password": "admin12345"
        }
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        # After login, session cookie should be set automatically by requests.Session

        # GET /api/conversations with authenticated session
        conv_resp = session.get(CONVERSATIONS_URL, timeout=TIMEOUT)
        assert conv_resp.status_code == 200, f"GET /api/conversations failed with status {conv_resp.status_code}"

        conversations = conv_resp.json()
        assert isinstance(conversations, list), "Conversations response is not a list"

    finally:
        # Logout to clear session if needed (best practice)
        session.post(f"{BASE_URL}/api/auth/logout", timeout=TIMEOUT)

test_get_api_conversations_with_authenticated_session()