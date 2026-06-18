#!/usr/bin/env python3
import json
import urllib.request

env = {}
for line in open("/opt/aichart/web/.env"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v.strip()

token = env["AICHART_SERVICE_TOKEN"]
base = f"http://127.0.0.1:{env.get('PORT', '3010')}"
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}


def get(path):
    req = urllib.request.Request(base + path, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        base + path, data=data, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


quotes = get("/api/agent/ea/live-quotes?symbol=EURUSD")
ask = float(quotes["quote"]["ask"])
bid = float(quotes["quote"]["bid"])
print("live ask", ask, "bid", bid)

# SL 25 pips below ask, TP 40 pips above
sl = round(ask - 0.0025, 5)
tp = round(ask + 0.0040, 5)

body = {
    "symbol": "EURUSD",
    "side": "buy",
    "market": "forex",
    "notional": 50,
    "entry": ask,
    "stop_loss": sl,
    "take_profit": tp,
    "confidence": 90,
    "rationale": "live-price test v3.02",
    "approved_by_user": True,
}
print("payload", json.dumps(body))
code, res = post("/api/agent/trade/open", body)
print("HTTP", code)
print(json.dumps(res, ensure_ascii=False, indent=2))

if res.get("ok"):
    print("SUCCESS trades:", json.dumps(get("/api/agent/trades/open"), ensure_ascii=False)[:1200])
