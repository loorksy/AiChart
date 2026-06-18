#!/usr/bin/env python3
import json
import os
import subprocess
import urllib.request
from datetime import datetime, timezone

ENV_PATH = "/opt/aichart/web/.env"


def load_env():
    env = {}
    for line in open(ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k] = v.strip()
    return env


def pg_query(sql):
    env = load_env()
    url = env.get("DATABASE_URL", "")
    if not url:
        return None, "no DATABASE_URL"
    try:
        import psycopg2
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute(sql)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()
        conn.close()
        return [dict(zip(cols, r)) for r in rows], None
    except ImportError:
        pass
    # fallback psql
    try:
        r = subprocess.run(
            ["psql", url, "-t", "-A", "-F", "|", "-c", sql],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if r.returncode != 0:
            return None, r.stderr
        lines = [ln for ln in r.stdout.strip().split("\n") if ln.strip()]
        return lines, None
    except Exception as e:
        return None, str(e)


def main():
    env = load_env()
    print("DATABASE_URL set:", bool(env.get("DATABASE_URL")))
    print("DB_PATH:", env.get("DB_PATH", ""))

    sql_conn = """
    SELECT id, user_id, status, last_heartbeat_at, ea_version, account_login,
           broker_name, created_at
    FROM ea_connections ORDER BY id DESC LIMIT 5;
    """
    rows, err = pg_query(sql_conn)
    print("\n=== ea_connections ===")
    if err:
        print("ERR:", err)
    else:
        for r in rows:
            print(r)

    sql_cmds = """
    SELECT id, command_type, status, created_at, acked_at,
           LEFT(COALESCE(error_message,''), 80) AS err
    FROM ea_commands ORDER BY id DESC LIMIT 20;
    """
    rows, err = pg_query(sql_cmds)
    print("\n=== recent ea_commands ===")
    if err:
        print("ERR:", err)
    else:
        for r in rows:
            print(r)

    sql_hb = """
    SELECT last_heartbeat_at,
           EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at::timestamptz)) AS age_sec
    FROM ea_connections ORDER BY id DESC LIMIT 1;
    """
    rows, err = pg_query(sql_hb)
    print("\n=== heartbeat age ===")
    if rows:
        print(rows)
    print("now UTC:", datetime.now(timezone.utc).isoformat())

    # Check nginx/heartbeat if log exists
    for logpath in (
        "/var/log/nginx/access.log",
        "/var/log/nginx/aichart.access.log",
    ):
        if os.path.isfile(logpath):
            r = subprocess.run(
                ["grep", "-c", "/api/ea/heartbeat", logpath],
                capture_output=True,
                text=True,
            )
            print(f"\n{logpath} heartbeat hits:", r.stdout.strip())
            r2 = subprocess.run(
                ["grep", "/api/ea/heartbeat", logpath],
                capture_output=True,
                text=True,
            )
            lines = r2.stdout.strip().split("\n")
            print("last 5 heartbeat log lines:")
            for ln in lines[-5:]:
                print(ln[:200])


if __name__ == "__main__":
    main()
