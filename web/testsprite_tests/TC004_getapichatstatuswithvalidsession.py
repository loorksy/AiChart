import requests

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
CHAT_STATUS_ENDPOINT = "/api/chat/status"
TIMEOUT = 30

def test_get_api_chat_status_with_valid_session():
    login_url = BASE_URL + LOGIN_ENDPOINT
    chat_status_url = BASE_URL + CHAT_STATUS_ENDPOINT

    login_payload = {
        "email": "admin@aichart.local",
        "password": "admin12345"
    }
    headers = {
        "Accept": "application/json"
    }

    # Start a session to persist cookies and headers
    with requests.Session() as session:
        try:
            # Login to obtain session cookie/authentication
            login_response = session.post(login_url, json=login_payload, headers=headers, timeout=TIMEOUT)
            assert login_response.status_code == 200, f"Login failed with status code {login_response.status_code}"
            # Optionally verify the presence of a session cookie or token
            assert ("set-cookie" in login_response.headers) or session.cookies.get_dict(), "No session cookie or auth set after login"

            # Access chat status page with authenticated session
            chat_status_response = session.get(chat_status_url, timeout=TIMEOUT)
            assert chat_status_response.status_code == 200, f"Chat status request failed with status {chat_status_response.status_code}"

            json_data = chat_status_response.json()

            assert isinstance(json_data, dict), "Response is not a JSON object"
            assert "ready" in json_data, "'ready' key not found in response"
            assert "model" in json_data, "'model' key not found in response"
            assert json_data["ready"] is True, "Chat status 'ready' is not True"
            assert isinstance(json_data["model"], str) and len(json_data["model"]) > 0, "Model info is missing or invalid"

            # Additional validations can be done here if needed

        except requests.RequestException as e:
            assert False, f"Request failed: {e}"

test_get_api_chat_status_with_valid_session()