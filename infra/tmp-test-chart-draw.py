#!/usr/bin/env python3
"""Queue MT5 chart capture and poll GET /api/agent/chart/{id}/mt5 until PNG ready."""
import json
import sys
import time
import urllib.error
import urllib.request

POLL_INTERVAL = 2
POLL_MAX = 60


def load_env(path="/opt/aichart/web/.env"):
    env = {}
    try:
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k] = v.strip()
    except OSError:
        pass
    return env


def main():
    env = load_env()
    token = env.get("AICHART_SERVICE_TOKEN", "")
    base = f"http://127.0.0.1:{env.get('PORT', '3010')}"
    if not token:
        print("AICHART_SERVICE_TOKEN missing")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    def get(path):
        req = urllib.request.Request(base + path, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read(), dict(r.headers)

    def post(path, body):
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            base + path, data=data, headers=headers, method="POST"
        )
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode())

    try:
        _, term_body, _ = get("/api/agent/ea/query-terminal")
        term = json.loads(term_body.decode())
        t = term.get("terminal") or {}
        print("ea_version:", t.get("ea_version", "UNKNOWN"))
        print("trade_allowed:", t.get("trade_allowed"))
        print("mql_trade_allowed:", t.get("mql_trade_allowed"))
    except Exception as e:
        print("query-terminal warn:", e)

    # Colored legacy drawing payload (v3.09 color test)
    drawings = [
        {
            "type": "price_line",
            "confidence": 80,
            "label": "Support",
            "color": "#22c55e",
            "points": [{"barsAhead": 0, "price": 1.0}],
        },
        {
            "type": "zone",
            "confidence": 75,
            "color": "#6366F1",
            "fill": True,
            "points": [
                {"barsAhead": 5, "price": 1.01},
                {"barsAhead": 0, "price": 1.005},
            ],
        },
    ]

    capture_key = f"snap_test_{int(time.time())}"
    body = {
        "symbol": "EURUSD",
        "interval": "",
        "recommendation_id": 0,
        "capture_key": capture_key,
        "drawings": drawings,
    }

    # Use chart snapshot route if available, else skip queue
    try:
        status, resp = post("/api/agent/chart/snapshot", {
            "symbol": "EURUSD",
            "interval": "1h",
            "chart_drawings": drawings,
        })
        print("snapshot:", status, resp)
        if resp.get("chart_url"):
            chart_url = resp["chart_url"]
            if "/mt5" in chart_url:
                poll_path = chart_url.replace("https://aichart.lork.cloud", "").split("?")[0]
            else:
                poll_path = f"/api/agent/chart/{capture_key}/mt5"
        else:
            poll_path = f"/api/agent/chart/{capture_key}/mt5"
    except urllib.error.HTTPError as e:
        print("snapshot failed:", e.code, e.read().decode()[:200])
        poll_path = f"/api/agent/chart/{capture_key}/mt5"

    print("polling", poll_path)
    deadline = time.time() + POLL_MAX
    while time.time() < deadline:
        try:
            status, data, hdrs = get(poll_path)
        except urllib.error.HTTPError as e:
            status = e.code
            data = e.read()
            hdrs = {}

        if status == 200 and data[:4] == b"\x89PNG":
            print("OK: PNG received", len(data), "bytes")
            sys.exit(0)
        if status == 202:
            print("pending…")
        elif status == 503:
            print("EA offline")
            sys.exit(1)
        else:
            print("status", status, data[:120])
        time.sleep(POLL_INTERVAL)

    print("timeout waiting for PNG")
    sys.exit(1)


if __name__ == "__main__":
    main()
