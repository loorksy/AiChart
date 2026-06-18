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
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


term = get("/api/agent/ea/query-terminal")
t = term.get("terminal", {})
print("ea_version:", t.get("ea_version", "UNKNOWN"))
print("trade_allowed:", t.get("trade_allowed"))
print("mql_trade_allowed:", t.get("mql_trade_allowed"))

if t.get("ea_version") != "3.04":
    print("STOP: reattach EA — need v3.04 on chart, got", t.get("ea_version"))
    raise SystemExit(1)

quotes = get("/api/agent/ea/live-quotes?symbol=EURUSD")
ask = float(quotes["quote"]["ask"])
body = {
    "symbol": "EURUSD",
    "side": "buy",
    "market": "forex",
    "notional": 50,
    "entry": ask,
    "stop_loss": round(ask - 0.0025, 5),
    "take_profit": round(ask + 0.004, 5),
    "confidence": 90,
    "rationale": "v3.04 filling fix test",
    "approved_by_user": True,
}
res = post("/api/agent/trade/open", body)
print(json.dumps(res, ensure_ascii=False, indent=2))
if res.get("ok"):
    print("trades:", json.dumps(get("/api/agent/trades/open"), ensure_ascii=False)[:1500])
