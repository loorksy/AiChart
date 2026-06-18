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


print("=== query_terminal ===")
term = get("/api/agent/ea/query-terminal")
print(json.dumps(term, ensure_ascii=False)[:2000])

print("\n=== live quotes ===")
quotes = get("/api/agent/ea/live-quotes?symbol=EURUSD")
print(json.dumps(quotes, ensure_ascii=False)[:800])

snap = get("/api/agent/market/snapshot?symbol=EURUSD&market=forex")
price = float(snap.get("price") or 1.1603)
sl = round(price - 0.0025, 5)
tp = round(price + 0.0040, 5)

body = {
    "symbol": "EURUSD",
    "side": "buy",
    "market": "forex",
    "notional": 30,
    "entry": price,
    "stop_loss": sl,
    "take_profit": tp,
    "confidence": 85,
    "rationale": "operator requested test trade - retry",
    "approved_by_user": True,
}
print("\n=== trade/open ===")
print(json.dumps(body, indent=2))
res = post("/api/agent/trade/open", body)
print(json.dumps(res, ensure_ascii=False, indent=2))

print("\n=== open trades ===")
print(json.dumps(get("/api/agent/trades/open"), ensure_ascii=False)[:1500])
