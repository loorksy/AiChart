import requests

BASE_URL = "http://localhost:3000"
LOGIN_URL = f"{BASE_URL}/api/auth/login"
CONVERSATIONS_URL = f"{BASE_URL}/api/conversations"

USERNAME = "lork@gmail.com"
PASSWORD = "lork0009"
TIMEOUT = 30


def test_get_api_conversations_id_with_valid_id_and_ownership():
    session = requests.Session()
    try:
        # Login to get JWT token
        login_payload = {"email": USERNAME, "password": PASSWORD}
        login_resp = session.post(LOGIN_URL, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        json_login = login_resp.json()
        # Expecting token under 'token' key per PRD conventions
        token = json_login.get("token")
        assert token, f"No token found in login response: {json_login}"
        headers = {"Authorization": f"Bearer {token}"}

        # Create a new conversation to use its ID
        create_resp = session.post(CONVERSATIONS_URL, headers=headers, timeout=TIMEOUT)
        assert create_resp.status_code == 200, f"Conversation creation failed: {create_resp.text}"
        conversation = create_resp.json()
        assert isinstance(conversation, dict), "Conversation response must be a dict"
        assert "id" in conversation, "No conversation ID in response"
        conversation_id = conversation["id"]

        # Get the conversation by ID
        get_resp = session.get(f"{CONVERSATIONS_URL}/{conversation_id}", headers=headers, timeout=TIMEOUT)
        assert get_resp.status_code == 200, f"Get conversation failed: {get_resp.text}"
        messages = get_resp.json()
        # Assert messages is a list or dict with stored messages
        assert isinstance(messages, (list, dict)), "Returned messages format invalid"

    finally:
        # Clean up: delete the created conversation if possible
        try:
            # API schema has no DELETE endpoint for conversation so skip delete or post delete if implemented
            pass
        except Exception:
            pass


test_get_api_conversations_id_with_valid_id_and_ownership()
