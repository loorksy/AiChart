#!/usr/bin/env python3
"""Post-deploy smoke tests on VPS."""
import hashlib
import hmac
import json
import subprocess
import sys
import urllib.error
import urllib.request

FAIL = 0


def ok(msg: str) -> None:
    print(f"PASS: {msg}")


def fail(msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"FAIL: {msg}")


def env(k: str) -> str:
    with open("/opt/aichart/web/.env") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return ""


def bridge_get(path: str, token: str, email: str) -> dict:
    sig = hmac.new(token.encode(), email.lower().encode(), hashlib.sha256).hexdigest()
    url = f"http://127.0.0.1:3010{path}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Aichart-User-Email": email,
            "X-Aichart-User-Sig": sig,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read())


def main() -> None:
    token = env("AICHART_SERVICE_TOKEN")
    if not token:
        fail("AICHART_SERVICE_TOKEN missing")
        sys.exit(1)

    email = subprocess.check_output(
        [
            "sudo",
            "-u",
            "postgres",
            "psql",
            "-d",
            "aichart",
            "-t",
            "-A",
            "-c",
            "SELECT email FROM users WHERE role='admin' LIMIT 1;",
        ],
        text=True,
    ).strip()

    # 1) Forex snapshot
    try:
        snap = bridge_get(
            "/api/agent/market/snapshot?symbol=EURUSD&market=forex&interval=1h",
            token,
            email,
        )
        s = snap.get("snapshot") or snap
        price = s.get("price")
        extra = s.get("extra") or {}
        rsi = extra.get("rsi14")
        if price and price > 0:
            ok(f"forex snapshot price={price}")
        else:
            fail(f"forex snapshot bad price: {price}")
        if rsi is not None:
            ok(f"forex snapshot rsi14={rsi:.1f}")
        else:
            fail("forex snapshot rsi14 null")
        if extra.get("ohlcSource"):
            ok(f"ohlcSource={extra.get('ohlcSource')}")
    except Exception as e:
        fail(f"forex snapshot: {e}")

    # 2) Crypto snapshot regression
    try:
        snap = bridge_get(
            "/api/agent/market/snapshot?symbol=BTCUSDT&market=crypto&interval=1h",
            token,
            email,
        )
        s = snap.get("snapshot") or snap
        if s.get("price") and s.get("price") > 0:
            ok(f"crypto snapshot price={s.get('price')}")
        else:
            fail(f"crypto snapshot bad: {s}")
    except Exception as e:
        fail(f"crypto snapshot: {e}")

    # 3) EA diagnostics
    try:
        diag = bridge_get("/api/agent/ea/diagnostics?symbol=EURUSD", token, email)
        if diag.get("online"):
            ok("EA online")
        else:
            fail(f"EA offline: {diag.get('message') or diag.get('status')}")
    except Exception as e:
        fail(f"ea diagnostics: {e}")

    # 4) Live quotes metrics endpoint
    try:
        q = bridge_get("/api/agent/ea/live-quotes?metrics=1", token, email)
        if "quotes" in q or "freshCount" in q:
            ok("live-quotes metrics endpoint")
        else:
            ok(f"live-quotes response keys={list(q.keys())[:6]}")
    except Exception as e:
        fail(f"live-quotes: {e}")

    # 5) Chart 503 body shape (non-existent rec or old rec)
    try:
        sig = hmac.new(token.encode(), email.lower().encode(), hashlib.sha256).hexdigest()
        url = "http://127.0.0.1:3010/api/agent/chart/22?format=json"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "X-Aichart-User-Email": email,
                "X-Aichart-User-Sig": sig,
                "Accept": "application/json",
            },
        )
        try:
            urllib.request.urlopen(req, timeout=30)
            fail("chart/22 expected 503")
        except urllib.error.HTTPError as e:
            body = json.loads(e.read())
            if body.get("reason") == "chart_render_failed" and body.get("hint"):
                ok("chart/22 503 with hint")
            else:
                fail(f"chart/22 503 body unexpected: {body}")
    except Exception as e:
        fail(f"chart/22 test: {e}")

    # 6) MCP health
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=10) as r:
            h = json.loads(r.read())
        if h.get("ok"):
            ok("MCP health ok")
        else:
            fail(f"MCP health: {h}")
    except Exception as e:
        fail(f"MCP health: {e}")

    # 7) EA ex5 on disk
    import os

    ex5 = "/opt/aichart/ea/mt5/AiChartBridge.ex5"
    if os.path.isfile(ex5) and os.path.getsize(ex5) > 100000:
        ok(f"EA ex5 on server ({os.path.getsize(ex5)} bytes)")
    else:
        fail("EA ex5 missing or too small")

    print(f"\n=== Smoke summary: {FAIL} failure(s) ===")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
