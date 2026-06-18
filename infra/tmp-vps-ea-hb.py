#!/usr/bin/env python3
import subprocess
out = subprocess.check_output(
    ["sudo", "-u", "postgres", "psql", "-d", "aichart", "-t", "-A", "-F", "|", "-c",
     "SELECT user_id, last_heartbeat_at, broker_name, account_login FROM ea_connections ORDER BY last_heartbeat_at DESC LIMIT 3;"],
    text=True,
)
print("ea_connections:")
for line in out.strip().splitlines():
    print(" ", line)
