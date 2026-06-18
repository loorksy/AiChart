#!/usr/bin/env python3
import subprocess
admin = subprocess.check_output(
    ["sudo", "-u", "postgres", "psql", "-d", "aichart", "-t", "-A", "-c",
     "SELECT id, email FROM users WHERE role='admin' LIMIT 1;"],
    text=True,
).strip()
print("admin:", admin)
conn = subprocess.check_output(
    ["sudo", "-u", "postgres", "psql", "-d", "aichart", "-t", "-A", "-F", "|", "-c",
     "SELECT user_id, last_heartbeat_at FROM ea_connections WHERE user_id IN (SELECT id FROM users WHERE role='admin' LIMIT 1);"],
    text=True,
).strip()
print("admin ea:", conn or "(no row)")
