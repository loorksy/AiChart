import requests

BASE_URL = "http://localhost:3000"
LOGIN_ENDPOINT = "/api/auth/login"
LOGOUT_ENDPOINT = "/api/auth/logout"
DASHBOARD_ENDPOINT = "/dashboard"
CHAT_ENDPOINT = "/chat"
CREDITS_CHECK_ENDPOINT = "/api/me"
SIGNALS_NEW_PAGE = "/signals/new"
HEADERS_JSON = {"Content-Type": "application/json"}
TIMEOUT = 30

def test_postapiauthlogoutwithauthenticatedsession():
    session = requests.Session()
    # Login payload and headers
    login_payload = {
        "email": "admin@aichart.local",
        "password": "admin12345"
    }
    
    try:
        # Step 1: Login
        login_resp = session.post(
            f"{BASE_URL}{LOGIN_ENDPOINT}",
            json=login_payload,
            timeout=TIMEOUT,
            headers=HEADERS_JSON,
        )
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        # After login, session cookie should be set automatically by requests.Session
        
        # Step 2: Access chat page (GET /chat) to verify authenticated area loads
        chat_resp = session.get(f"{BASE_URL}{CHAT_ENDPOINT}", timeout=TIMEOUT)
        assert chat_resp.status_code == 200, f"Chat page did not load after login, status: {chat_resp.status_code}"
        assert 'text/html' in chat_resp.headers.get('Content-Type', ''), "Chat page content is not HTML"
        
        # Step 3: Access dashboard (GET /dashboard) to verify credits display authenticated page
        dashboard_resp = session.get(f"{BASE_URL}{DASHBOARD_ENDPOINT}", timeout=TIMEOUT)
        assert dashboard_resp.status_code == 200, f"Dashboard did not load after login, status: {dashboard_resp.status_code}"
        assert 'text/html' in dashboard_resp.headers.get('Content-Type', ''), "Dashboard content is not HTML"
        
        # Step 4: Check user profile and credits via API (GET /api/me) to confirm authenticated info
        credits_resp = session.get(f"{BASE_URL}{CREDITS_CHECK_ENDPOINT}", timeout=TIMEOUT)
        assert credits_resp.status_code == 200, f"User profile (credits) API returned {credits_resp.status_code}"
        credits_data = credits_resp.json()
        assert "settings" in credits_data, "User profile response missing 'settings'"
        assert "quota" in credits_data, "User profile response missing 'quota'"

        # Step 5: Access signals wizard page to verify authentication and navigation (RTL Arabic UI)
        signals_resp = session.get(f"{BASE_URL}{SIGNALS_NEW_PAGE}", timeout=TIMEOUT)
        assert signals_resp.status_code == 200, f"Signals wizard page did not load, status: {signals_resp.status_code}"
        assert 'text/html' in signals_resp.headers.get('Content-Type', ''), "Signals wizard content is not HTML"
        
        # Step 6: Perform logout (POST /api/auth/logout)
        logout_resp = session.post(f"{BASE_URL}{LOGOUT_ENDPOINT}", timeout=TIMEOUT, headers=HEADERS_JSON)
        assert logout_resp.status_code == 200, f"Logout failed with status {logout_resp.status_code}"
        
        # Step 7: Verify session cookie cleared by trying to access protected resource (GET /dashboard)
        post_logout_dashboard_resp = session.get(f"{BASE_URL}{DASHBOARD_ENDPOINT}", timeout=TIMEOUT, allow_redirects=False)
        # Should require login now: expecting redirect or 401 unauthorized
        assert post_logout_dashboard_resp.status_code in (302, 307, 401, 403), \
            f"Access to protected resource after logout should be denied but got status {post_logout_dashboard_resp.status_code}"
        
    finally:
        session.close()

test_postapiauthlogoutwithauthenticatedsession()
