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


# ensure_symbol via queue - check if there's route
import urllib.error
for path, body in [
    ("/api/agent/ea/pending-order", None),
]:
    pass

# use raw command via maintenance if exists - skip

print("Checking intent payload lots for last market cmd...")
import subprocess
out = subprocess.check_output(
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
        "SELECT payload_json FROM ea_commands WHERE id=49;",
    ],
    text=True,
)
print("payload", out.strip())
