import requests

BASE_URL = "http://localhost:3000"
TIMEOUT = 30

def test_post_api_chat_without_authentication():
    url = f"{BASE_URL}/api/chat"
    headers = {
        "Content-Type": "application/json"
    }
    payload = {
        "message": "Test message",
        "stream": True
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    
    assert response.status_code in (401, 403), f"Expected 401 or 403 status code for unauthorized access, got {response.status_code}"
    # Check that the response indicates an authorization error
    content_type = response.headers.get("Content-Type", "")
    if "application/json" in content_type:
        try:
            json_resp = response.json()
            error_msg = json_resp.get("error") or json_resp.get("message") or ""
            assert (any(keyword in error_msg.lower() for keyword in ["auth", "unauthorized", "authorization"]) 
                    or any(keyword in error_msg for keyword in ["غير مصرّح", "تسجيل الدخول"])), \
                f"Expected authorization error message, got: {error_msg}"
        except ValueError:
            pass
    else:
        text = response.text.lower()
        assert ("unauthorized" in text or "authorization" in text or "auth" in text or "غير مصرّح" in response.text or "تسجيل الدخول" in response.text), \
            f"Expected authorization error message in response body, got: {response.text}"

test_post_api_chat_without_authentication()