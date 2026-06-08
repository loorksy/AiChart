import requests

BASE_URL = "http://localhost:3000"
LOGIN_PATH = "/api/auth/login"
TIMEOUT = 30

def test_postapiauthloginwithinvalidcredentials():
    url = BASE_URL + LOGIN_PATH
    payload = {
        "email": "admin@aichart.local",
        "password": "wrongpassword"
    }
    headers = {
        "Content-Type": "application/json",
        "Accept-Language": "ar"  # For RTL Arabic UI indication
    }
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    assert response.status_code == 401, f"Expected status code 401, got {response.status_code}"
    # Validate response content contains indication of invalid credentials
    try:
        json_response = response.json()
    except Exception:
        json_response = None

    if json_response:
        # Check typical error message presence, including Arabic message
        assert ("Invalid credentials" in str(json_response)) or \
               ("البريد أو كلمة المرور غير صحيحة." in str(json_response)) or \
               ("error" in json_response and ("invalid" in str(json_response["error"]).lower() or "البريد أو كلمة المرور غير صحيحة." in str(json_response["error"]))) or \
               ("message" in json_response and "invalid" in str(json_response["message"]).lower()), \
            f"Response JSON does not indicate invalid credentials: {json_response}"
    else:
        # If no JSON, optionally check text content
        assert "Invalid credentials" in response.text or "invalid" in response.text.lower() or "البريد أو كلمة المرور غير صحيحة." in response.text, \
            f"Response text does not indicate invalid credentials: {response.text}"

    # Verify that user remains unauthenticated by trying to access a protected endpoint
    protected_url = BASE_URL + "/api/me"
    try:
        protected_response = requests.get(protected_url, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Protected request failed: {e}"
    # Expect unauthorized or redirect (usually 401 or 403)
    assert protected_response.status_code in (401, 403), f"Expected 401 or 403 for unauthenticated access, got {protected_response.status_code}"

test_postapiauthloginwithinvalidcredentials()
