import requests

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
CHAT_ENDPOINT = "/chat"
DASHBOARD_ENDPOINT = "/dashboard"
SIGNALS_NEW_ENDPOINT = "/signals/new"

def test_postapiauthloginwithvalidcredentials():
    session = requests.Session()
    timeout = 30
    # Login payload with valid credentials
    login_payload = {
        "email": "admin@aichart.local",
        "password": "admin12345"
    }
    headers = {
        "Content-Type": "application/json",
        "Accept-Language": "ar"  # RTL Arabic UI indication
    }

    # 1. POST /api/auth/login
    login_response = session.post(
        BASE_URL + LOGIN_ENDPOINT,
        json=login_payload,
        headers=headers,
        timeout=timeout
    )
    try:
        assert login_response.status_code == 200, f"Expected 200 OK but got {login_response.status_code}"
        # Check that after login some cookie is set to maintain session
        cookie_jar = session.cookies
        assert len(cookie_jar) > 0, "No cookies set after login, session not established"

        # 2. GET /chat page loads with authenticated session
        chat_response = session.get(
            BASE_URL + CHAT_ENDPOINT,
            headers={"Accept-Language": "ar"},
            timeout=timeout
        )
        assert chat_response.status_code == 200, f"Chat page did not load, status {chat_response.status_code}"
        assert "text/html" in chat_response.headers.get("Content-Type", ""), "Chat page did not return HTML content"

        # 3. GET /dashboard credits display
        dashboard_response = session.get(
            BASE_URL + DASHBOARD_ENDPOINT,
            headers={"Accept-Language": "ar"},
            timeout=timeout
        )
        assert dashboard_response.status_code == 200, f"Dashboard page did not load, status {dashboard_response.status_code}"
        assert "text/html" in dashboard_response.headers.get("Content-Type", ""), "Dashboard page did not return HTML content"
        # Check if dashboard contains credits text (simple heuristic)
        dashboard_text = dashboard_response.text
        assert any(word in dashboard_text.lower() for word in ["credit", "رصيد"]), "Dashboard does not display credits information"

        # 4. GET /signals/new for signals wizard navigation
        signals_response = session.get(
            BASE_URL + SIGNALS_NEW_ENDPOINT,
            headers={"Accept-Language": "ar"},
            timeout=timeout
        )
        assert signals_response.status_code == 200, f"Signals wizard page did not load, status {signals_response.status_code}"
        assert "text/html" in signals_response.headers.get("Content-Type", ""), "Signals wizard page did not return HTML content"

    finally:
        session.close()


test_postapiauthloginwithvalidcredentials()
