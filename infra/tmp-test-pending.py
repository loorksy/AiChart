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


def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        base + path, data=data, headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode())


body = {
    "symbol": "EURUSD",
    "side": "buy",
    "order_type": "limit",
    "lots": 0.01,
    "price": 1.1500,
    "stop_loss": 1.1450,
    "take_profit": 1.1600,
}
print(json.dumps(post("/api/agent/ea/pending-order", body), ensure_ascii=False, indent=2))
