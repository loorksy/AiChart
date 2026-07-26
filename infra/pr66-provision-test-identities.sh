#!/usr/bin/env bash
# Provision release-test identity metadata on VPS. Never echoes secret values.
set -euo pipefail

SECRET_DIR=/root/.config/aichart
SECRET_FILE="$SECRET_DIR/release-test.env"
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "secret_file=missing"
  exit 2
fi
chmod 600 "$SECRET_FILE"
echo "secret_file=configured"

python3 - <<'PY'
from pathlib import Path
import os, subprocess, urllib.parse

text = Path("/root/.config/aichart/release-test.env").read_text(encoding="utf-8", errors="ignore")
keys = {}
vals = {}
for line in text.splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k,v=line.split("=",1)
    k=k.strip(); v=v.strip().strip('"').strip("'")
    keys[k] = bool(v)
    vals[k] = v
for k in [
    "MCP_TEST_EMAIL","WEB_TEST_EMAIL","WEB_TEST_PASSWORD","MCP_TEST_PASSWORD",
    "PROVIDER_RELEASE_EA_USER_ID","AICHART_DISABLE_LIVE_ORDERS","MCP_TEST_URL",
]:
    print(f"{k}={'configured' if keys.get(k) else 'missing'}")

email = vals.get("MCP_TEST_EMAIL") or vals.get("WEB_TEST_EMAIL") or ""
if not email:
    print("test_email=missing")
    raise SystemExit(2)

prod_env = Path("/opt/aichart/web/.env").read_text(encoding="utf-8", errors="ignore")
db = None
for line in prod_env.splitlines():
    if line.startswith("DATABASE_URL="):
        db = line.split("=",1)[1].strip().strip('"').strip("'")
        break
if not db:
    print("database_url=missing")
    raise SystemExit(2)

# Look up user by email using dollar-quoting to avoid injection/print of password
q = "SELECT id::text, coalesce(role,''), coalesce(status,'') FROM users WHERE lower(email)=lower(%s);"
# use psycopg via python if available, else psql with escaped literal
try:
    import psycopg
    with psycopg.connect(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text, coalesce(role,''), coalesce(status,'') FROM users WHERE lower(email)=lower(%s)",
                (email,),
            )
            row = cur.fetchone()
            if not row:
                print("test_user=missing")
                raise SystemExit(2)
            uid, role, status = row
            cur.execute("SELECT count(*) FROM user_entitlements WHERE user_id=%s", (int(uid),))
            ent = cur.fetchone()[0]
            # discover ea table
            cur.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename ILIKE '%%ea%%' OR tablename ILIKE '%%bridge%%')"
            )
            tables = [r[0] for r in cur.fetchall()]
            ea_count = 0
            for t in tables:
                if "connection" in t or t in ("ea_live_state","ea_accounts","mt_ea_connections","ea_connections"):
                    try:
                        cur.execute(f'SELECT count(*) FROM "{t}" WHERE user_id=%s', (int(uid),))
                        ea_count = max(ea_count, int(cur.fetchone()[0]))
                    except Exception:
                        conn.rollback()
except Exception as e:
    # fallback psql
    esc = email.replace("'", "''")
    out = subprocess.check_output(
        ["psql", db, "-At", "-F", "|", "-c",
         f"SELECT id::text, coalesce(role,''), coalesce(status,'') FROM users WHERE lower(email)=lower('{esc}');"],
        text=True,
    ).strip()
    if not out:
        print("test_user=missing")
        raise SystemExit(2)
    uid, role, status = out.split("|", 2)
    ent = subprocess.check_output(
        ["psql", db, "-At", "-c", f"SELECT count(*) FROM user_entitlements WHERE user_id={int(uid)};"],
        text=True,
    ).strip()
    tables = subprocess.check_output(
        ["psql", db, "-At", "-c",
         "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename ILIKE '%ea%' OR tablename ILIKE '%bridge%');"],
        text=True,
    ).strip().splitlines()
    ea_count = 0

print(f"test_user=configured")
print(f"test_user_id={uid}")
print(f"test_user_role={role}")
print(f"test_user_status={status}")
print(f"test_user_entitlements_rows={ent}")
print(f"ea_related_tables={','.join(tables) if tables else 'none'}")
print(f"test_user_ea_connections={ea_count}")

# inject EA user id into secret file (id only)
secret = Path("/root/.config/aichart/release-test.env")
lines = [l for l in secret.read_text(encoding="utf-8").splitlines()
         if not l.startswith("PROVIDER_RELEASE_EA_USER_ID=")
         and not l.startswith("AICHART_AGENT_USER_ID=")]
lines.append(f"PROVIDER_RELEASE_EA_USER_ID={uid}")
lines.append(f"AICHART_AGENT_USER_ID={uid}")
if not any(l.startswith("AICHART_DISABLE_LIVE_ORDERS=") for l in lines):
    lines.append("AICHART_DISABLE_LIVE_ORDERS=1")
secret.write_text("\n".join(lines) + "\n", encoding="utf-8")
secret.chmod(0o600)
print("ea_user_id_injected=configured")
print("is_admin=" + ("yes" if role == "admin" else "no"))
PY

echo "provision_done"
