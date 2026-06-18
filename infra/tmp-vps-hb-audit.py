#!/usr/bin/env python3
import subprocess
from collections import Counter

ENV_PATH = "/opt/aichart/web/.env"


def db_url():
    for line in open(ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    return ""

SQL = """
SELECT id, user_id, status, last_heartbeat_at, account_login, broker_name,
       LEFT(token_hash, 16) AS token_hash_prefix, created_at
FROM ea_connections ORDER BY id DESC LIMIT 3;
"""

url = db_url()
print("DB:", url[:40] + "..." if url else "missing")
r = subprocess.run(
    ["psql", url, "-c", SQL],
    capture_output=True,
    text=True,
)
print(r.stdout or r.stderr)

print("=== heartbeat status codes (last 30 from nginx) ===")
r2 = subprocess.run(
    ["grep", "/api/ea/heartbeat", "/var/log/nginx/access.log"],
    capture_output=True,
    text=True,
)
lines = r2.stdout.strip().split("\n")[-30:]
from collections import Counter
codes = Counter()
for ln in lines:
    parts = ln.split('"')
    if len(parts) > 2:
        req = parts[1]
        if "POST" in req:
            # status after request
            tail = ln.split('"')[2].strip().split()
            if tail:
                codes[tail[0]] += 1
for code, n in sorted(codes.items()):
    print(f"  HTTP {code}: {n} (in last 30 lines)")

print("\n=== last successful heartbeat (200) ===")
r3 = subprocess.run(
    ["grep", "/api/ea/heartbeat", "/var/log/nginx/access.log"],
    capture_output=True,
    text=True,
)
for ln in reversed(r3.stdout.strip().split("\n")):
    if " 200 " in ln or '" 200 ' in ln:
        print(ln[:220])
        break
else:
    print("(none found in full log scan - trying tail 500)")
    for ln in reversed(r3.stdout.strip().split("\n")[-500:]):
        if " 200 " in ln:
            print(ln[:220])
            break

print("\n=== first 401 after last 200 ===")
last_200_idx = -1
all_lines = r3.stdout.strip().split("\n")
for i, ln in enumerate(all_lines):
    if " 200 " in ln and "/api/ea/heartbeat" in ln:
        last_200_idx = i
for ln in all_lines[last_200_idx + 1 : last_200_idx + 6] if last_200_idx >= 0 else []:
    print(ln[:220])
