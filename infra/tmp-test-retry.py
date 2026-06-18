#!/usr/bin/env python3
import json
import urllib.request
import time

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


for attempt in range(3):
    d = get("/api/agent/ea/diagnostics?symbol=EURUSD")
    print(
        f"attempt {attempt+1}: online={d.get('online')} mode={d.get('account_trade_mode')} fresh={d.get('heartbeatFresh')}"
    )
    if d.get("online") and d.get("heartbeatFresh"):
        break
    time.sleep(8)

risk = get("/api/agent/risk/status")
pref = risk.get("executionEnv", {}).get("preference")
mode = d.get("account_trade_mode")
if mode and pref != mode:
    print("sync env to", mode)
    post("/api/agent/execution/env", {"preference": mode})

if not d.get("online"):
    print("EA offline — ensure MT5 open with EA v3.04 on chart")
    raise SystemExit(1)

q = get("/api/agent/ea/live-quotes?symbol=EURUSD")
ask = float(q["quote"]["ask"])
res = post(
    "/api/agent/trade/open",
    {
        "symbol": "EURUSD",
        "side": "buy",
        "market": "forex",
        "notional": 50,
        "entry": ask,
        "stop_loss": round(ask - 0.0025, 5),
        "take_profit": round(ask + 0.004, 5),
        "confidence": 90,
        "approved_by_user": True,
        "rationale": "operator retry",
    },
)
print(json.dumps(res, ensure_ascii=False, indent=2))
if res.get("ok"):
    print(json.dumps(get("/api/agent/trades/open"), ensure_ascii=False)[:1500])
