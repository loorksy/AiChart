#!/usr/bin/env python3
"""Diagnose EA online/offline flapping on VPS."""
import json
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timezone

ENV_PATH = "/opt/aichart/web/.env"
DB_PATH = "/opt/aichart/web/data/aichart.db"


def load_env():
    env = {}
    for line in open(ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k] = v.strip()
    return env


def api_get(base, token, path):
    req = urllib.request.Request(
        base + path,
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def main():
    env = load_env()
    token = env["AICHART_SERVICE_TOKEN"]
    base = f"http://127.0.0.1:{env.get('PORT', '3010')}"

    print("=== API checks ===")
    for path in (
        "/api/agent/portfolio",
        "/api/agent/ea/diagnostics?symbol=EURUSD",
        "/api/agent/ea/query-terminal",
        "/api/agent/risk/status",
    ):
        try:
            _, data = api_get(base, token, path)
            print(f"\n--- {path} ---")
            print(json.dumps(data, ensure_ascii=False, indent=2)[:1200])
        except urllib.error.HTTPError as e:
            print(f"\n--- {path} HTTP {e.code} ---")
            print(e.read().decode()[:400])
        except Exception as e:
            print(f"\n--- {path} ERR --- {e}")

    print("\n=== DB: ea_connections ===")
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, user_id, status, last_heartbeat_at, account_login, broker,
                   ea_version, created_at
            FROM ea_connections
            ORDER BY last_heartbeat_at DESC
            LIMIT 5
            """
        ).fetchall()
        for row in rows:
            print(dict(row))
    except Exception as e:
        print("ea_connections query failed:", e)
        try:
            cols = conn.execute("PRAGMA table_info(ea_connections)").fetchall()
            print("columns:", [c[1] for c in cols])
        except Exception:
            pass

    print("\n=== DB: recent ea_commands (last 15) ===")
    try:
        rows = conn.execute(
            """
            SELECT id, command_type, status, created_at, acked_at, error_message
            FROM ea_commands
            ORDER BY id DESC
            LIMIT 15
            """
        ).fetchall()
        for row in rows:
            print(dict(row))
    except Exception as e:
        print("ea_commands failed:", e)

    print("\n=== DB: draw_and_capture last 10 ===")
    try:
        rows = conn.execute(
            """
            SELECT id, status, created_at, acked_at, error_message
            FROM ea_commands
            WHERE command_type = 'draw_and_capture'
            ORDER BY id DESC
            LIMIT 10
            """
        ).fetchall()
        for row in rows:
            print(dict(row))
    except Exception as e:
        print("draw commands failed:", e)

    print("\n=== Heartbeat freshness (now UTC) ===")
    now = datetime.now(timezone.utc)
    print("now:", now.isoformat())
    try:
        row = conn.execute(
            "SELECT last_heartbeat_at, status FROM ea_connections ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row:
            hb = row[0]
            print("last_heartbeat_at:", hb, "status:", row[1])
            if hb:
                try:
                    t = datetime.fromisoformat(hb.replace("Z", "+00:00"))
                    if t.tzinfo is None:
                        t = t.replace(tzinfo=timezone.utc)
                    age = (now - t).total_seconds()
                    print(f"age_seconds: {age:.1f} (offline if > ~90s typically)")
                except Exception as ex:
                    print("parse error:", ex)
    except Exception as e:
        print(e)

    conn.close()


if __name__ == "__main__":
    main()
