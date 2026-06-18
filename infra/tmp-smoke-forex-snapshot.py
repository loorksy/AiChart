#!/usr/bin/env python3
import hashlib
import hmac
import json
import subprocess
import urllib.request


def env(k: str) -> str:
    with open("/opt/aichart/web/.env") as f:
        for line in f:
            if line.startswith(k + "="):
                return line.split("=", 1)[1].strip()
    return ""


token = env("AICHART_SERVICE_TOKEN")
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
sig = hmac.new(token.encode(), email.lower().encode(), hashlib.sha256).hexdigest()
url = "http://127.0.0.1:3010/api/agent/market/snapshot?symbol=EURUSD&market=forex&interval=1h"
req = urllib.request.Request(
    url,
    headers={
        "Authorization": f"Bearer {token}",
        "X-Aichart-User-Email": email,
        "X-Aichart-User-Sig": sig,
        "Accept": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.loads(r.read())
print(json.dumps(data, ensure_ascii=False)[:800])
