#!/usr/bin/env python3
import json
import urllib.request

env = {}
for line in open("/opt/aichart/web/.env", encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v.strip()

token = env["AICHART_SERVICE_TOKEN"]
base = f"http://127.0.0.1:{env.get('PORT', '3010')}"
headers = {"Authorization": f"Bearer {token}"}

for path in ("/api/agent/portfolio", "/api/agent/ea/diagnostics?symbol=EURUSD"):
    try:
        req = urllib.request.Request(base + path, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        print(f"=== {path} ===")
        if "forex" in data:
            ea = data.get("forex", {}).get("ea", {})
            print("ea.online:", ea.get("online"))
            print("ea.last_seen:", ea.get("last_seen"))
        else:
            print(json.dumps(data, ensure_ascii=False)[:600])
    except Exception as e:
        print(f"=== {path} ERR ===", e)
