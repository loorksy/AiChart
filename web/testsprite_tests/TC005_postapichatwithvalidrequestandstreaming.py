import requests
import json

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
CHAT_ENDPOINT = "/api/chat"

USER_EMAIL = "admin@aichart.local"
USER_PASSWORD = "admin12345"

TIMEOUT = 30

def test_post_api_chat_streaming_valid_request():
    session = requests.Session()
    # Login with provided credentials and get JWT token/cookies
    login_payload = {
        "email": USER_EMAIL,
        "password": USER_PASSWORD
    }
    try:
        login_resp = session.post(
            f"{BASE_URL}{LOGIN_ENDPOINT}",
            json=login_payload,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        # Expect some kind of authorization token or cookie is set in session
        # The API likely issues a cookie-based session or returns JWT in body.

        # Prepare POST /api/chat payload with stream=true and message
        chat_payload = {
            "message": "اختبار رسالة valid chat message",  # RTL Arabic text with English phrase to confirm RTL
            "stream": True
        }

        headers = {
            "Accept": "text/event-stream"
        }
        chat_resp = session.post(
            f"{BASE_URL}{CHAT_ENDPOINT}",
            json=chat_payload,
            headers=headers,
            stream=True,
            timeout=TIMEOUT
        )
        assert chat_resp.status_code == 200, f"Chat POST returned status {chat_resp.status_code}"
        # Validate that response is SSE with events including delta, activity, done
        # We check chunks to find these event types in streaming SSE format

        found_delta = False
        found_activity = False
        found_done = False

        # We read the streaming content line by line
        for line in chat_resp.iter_lines(decode_unicode=True):
            if line.startswith("event: delta"):
                found_delta = True
            elif line.startswith("event: activity"):
                found_activity = True
            elif line.startswith("event: done"):
                found_done = True

            # Early exit if all found
            if found_delta and found_activity and found_done:
                break

        assert found_delta, "Did not receive 'delta' SSE event"
        assert found_activity, "Did not receive 'activity' SSE event"
        assert found_done, "Did not receive 'done' SSE event"

    finally:
        session.close()

test_post_api_chat_streaming_valid_request()