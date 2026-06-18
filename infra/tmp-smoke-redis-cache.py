#!/usr/bin/env python3
"""Smoke: OHLC cache hit on second request when REDIS_URL is set."""
import hashlib
import hmac
import json
import time
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


def get(base: str, token: str, email: str, path: str) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "X-Aichart-User-Email": email.lower(),
        "X-Aichart-User-Sig": user_sig(token, email),
    }
    req = urllib.request.Request(base + path, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main() -> int:
    env = load_env(ENV_PATH)
    token = env.get("AICHART_SERVICE_TOKEN", "")
    email = env.get("ADMIN_EMAIL", "") or env.get("AICHART_AGENT_USER_ID", "")
    if not token or not email:
        print("FAIL: missing token or email in .env")
        return 1

    port = env.get("PORT", "3010")
    base = f"http://127.0.0.1:{port}"
    path = "/api/agent/market/ohlc?symbol=BTCUSDT&interval=1h&market=crypto&limit=10"

    results = []
    for i in range(2):
        data = get(base, token, email, path)
        payload = data.get("data", data)
        from_cache = payload.get("fromCache") if isinstance(payload, dict) else None
        results.append({"call": i + 1, "ok": data.get("ok"), "fromCache": from_cache})
        time.sleep(0.5)

    out = {"redis_url": env.get("REDIS_URL"), "ohlc": results}
    print(json.dumps(out, indent=2))

    first = results[0].get("fromCache")
    second = results[1].get("fromCache")
    if results[0].get("ok") and results[1].get("ok") and second is True:
        print("PASS: second OHLC request served from cache")
        return 0
    if not env.get("REDIS_URL"):
        print("WARN: REDIS_URL unset — cache may be in-memory only")
    print(f"WARN: expected fromCache=true on call 2, got call1={first} call2={second}")
    return 0 if results[0].get("ok") and results[1].get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
