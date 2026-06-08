import requests

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
CONVERSATIONS_ENDPOINT = "/api/conversations"
TIMEOUT = 30

def test_post_api_conversations_with_authenticated_session():
    session = requests.Session()
    create_conv_resp = None
    conversation = None
    try:
        # Login with admin credentials to get JWT session
        login_payload = {
            "email": "admin@aichart.local",
            "password": "admin12345"
        }
        login_resp = session.post(
            BASE_URL + LOGIN_ENDPOINT,
            json=login_payload,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        # Expect a JWT session cookie or token. The PRD states JWT-backed session.
        # Assuming session cookie maintained automatically by requests.Session()

        # Create a new conversation
        create_conv_resp = session.post(
            BASE_URL + CONVERSATIONS_ENDPOINT,
            timeout=TIMEOUT
        )
        assert create_conv_resp.status_code == 200, f"Conversation creation failed: {create_conv_resp.text}"
        conversation = create_conv_resp.json()
        # Validate keys in conversation object - expect an 'id' key
        assert isinstance(conversation, dict), "Conversation response is not a dict"
        assert "id" in conversation, "Conversation id missing in response"
        assert isinstance(conversation["id"], int) and conversation["id"] > 0, "Conversation id is invalid"

    finally:
        # Cleanup: delete the created conversation if possible
        conv_id = None
        try:
            if create_conv_resp and create_conv_resp.status_code == 200 and conversation:
                conv_id = conversation.get("id")
            if conv_id:
                delete_resp = session.delete(
                    f"{BASE_URL}{CONVERSATIONS_ENDPOINT}/{conv_id}",
                    timeout=TIMEOUT
                )
                # Deletion might not be supported by the API or might return 204 or 200
                assert delete_resp.status_code in (200, 204), f"Cleanup delete failed: {delete_resp.text}"
        except Exception:
            # ignore cleanup errors
            pass

test_post_api_conversations_with_authenticated_session()
