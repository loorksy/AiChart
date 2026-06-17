#!/usr/bin/env python3
"""Smoke: GET /api/agent/trade/readiness via bridge token + user HMAC."""
import hashlib
import hmac
import json
import sys
import urllib.error
import urllib.request

ENV_PATH = "/opt/aichart/web/.env"


def load_env(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v.strip()
    return env


def user_sig(token: str, email: str) -> str:
    return hmac.new(
        token.encode(),
        email.lower().encode(),
        hashlib.sha256,
    ).hexdigest()


def get(base: str, token: str, email: str, path: str) -> tuple[int, object]:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "X-Aichart-User-Email": email.lower(),
        "X-Aichart-User-Sig": user_sig(token, email),
    }
    req = urllib.request.Request(base + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def main() -> int:
    env = load_env(ENV_PATH)
    token = env.get("AICHART_SERVICE_TOKEN", "")
    email = env.get("ADMIN_EMAIL", "") or env.get("AICHART_AGENT_USER_ID", "")
    if not token:
        print("FAIL: AICHART_SERVICE_TOKEN missing in", ENV_PATH)
        return 1
    if not email or "@" not in email:
        print("FAIL: ADMIN_EMAIL missing in", ENV_PATH)
        return 1

    port = env.get("PORT", "3010")
    base = f"http://127.0.0.1:{port}"

    paths = [
        "/api/agent/trade/readiness?market=forex",
        "/api/agent/trade/readiness?symbol=EURUSD&market=forex&confidence=85",
        "/api/agent/trade/readiness?symbol=EURUSD&market=forex&confidence=50",
        "/api/agent/model",
    ]

    ok = True
    for path in paths:
        status, data = get(base, token, email, path)
        print(f"\n=== {path} HTTP {status} ===")
        print(json.dumps(data, ensure_ascii=False, indent=2)[:2500])

        payload = data.get("data", data) if isinstance(data, dict) else data

        if path.endswith("confidence=50"):
            if isinstance(payload, dict):
                ready = payload.get("ready")
                checks = payload.get("checks") or {}
                gate = checks.get("confidenceGate") or {}
                if ready is not False and gate.get("passes") is not False:
                    print("WARN: expected ready=false or confidenceGate.passes=false for confidence=50")
                    ok = False
        elif path.endswith("confidence=85"):
            if isinstance(payload, dict) and "checks" in payload:
                gate = (payload.get("checks") or {}).get("confidenceGate")
                if not gate or "minConfidence" not in gate:
                    print("WARN: missing confidenceGate in checks")
                    ok = False
        elif path == "/api/agent/model":
            if isinstance(data, dict) and "serverVersion" not in data:
                print("WARN: model route missing serverVersion")
                ok = False

    print("\n=== RESULT ===")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
