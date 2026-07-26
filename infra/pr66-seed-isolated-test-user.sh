#!/usr/bin/env bash
# Copy dedicated test user + entitlement + EA connection metadata from prod DB
# into isolated aichart_rel_pr66. Never prints emails/passwords/hashes/tokens.
set -euo pipefail

python3 - <<'PY'
import subprocess
from pathlib import Path

def dburl(path):
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("missing DATABASE_URL")

prod = dburl("/opt/aichart/web/.env")
rel = dburl("/opt/aichart-rc-pr66-2e1134a/web/.env")

# Ensure isolated schema exists (init via web initDb once)
print("ensuring_isolated_schema")
subprocess.check_call(
    [
        "bash",
        "-lc",
        "cd /opt/aichart-rc-pr66-2e1134a/web && set -a && source .env && set +a && npx tsx -e '"
        "import { initDb } from \"./src/lib/db/index.ts\";"
        "(async()=>{ await initDb(); console.log(\"initDb_ok\"); })().catch(e=>{ console.error(e); process.exit(1); });"
        "'",
    ],
)

email = None
for line in Path("/root/.config/aichart/release-test.env").read_text().splitlines():
    if line.startswith("WEB_TEST_EMAIL=") or line.startswith("MCP_TEST_EMAIL="):
        email = line.split("=", 1)[1].strip()
        break
if not email:
    raise SystemExit("test email missing")

# Fetch user row as COPY via SQL dump of selected columns for that id only
uid = subprocess.check_output(
    ["psql", prod, "-At", "-c", f"SELECT id FROM users WHERE lower(email)=lower('{email.replace(chr(39), chr(39)+chr(39))}');"],
    text=True,
).strip()
if not uid:
    raise SystemExit("test_user_missing_in_prod")
print(f"source_user_id={uid}")

# Use INSERT...SELECT across databases via postgres_fdw is hard; use pg_dump style row copy with COPY TO STDOUT
# Safer: python psycopg dual connection
try:
    import psycopg
except ImportError:
    subprocess.check_call(["pip", "install", "-q", "psycopg[binary]"])
    import psycopg

with psycopg.connect(prod) as pc, psycopg.connect(rel) as rc:
    pc.autocommit = True
    rc.autocommit = True
    with pc.cursor() as cur, rc.cursor() as rcur:
        cur.execute("SELECT * FROM users WHERE id=%s", (int(uid),))
        cols = [d.name for d in cur.description]
        row = cur.fetchone()
        if not row:
            raise SystemExit("user_row_missing")
        # upsert into isolated
        placeholders = ",".join(["%s"] * len(cols))
        colsql = ",".join(cols)
        updates = ",".join(f"{c}=EXCLUDED.{c}" for c in cols if c != "id")
        rcur.execute(
            f"INSERT INTO users ({colsql}) VALUES ({placeholders}) ON CONFLICT (id) DO UPDATE SET {updates}",
            row,
        )
        # sync sequence
        rcur.execute("SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))")
        print("users_seeded=configured")

        # entitlements
        cur.execute("SELECT * FROM user_entitlements WHERE user_id=%s", (int(uid),))
        ent_cols = [d.name for d in cur.description] if cur.description else []
        ents = cur.fetchall()
        rcur.execute("DELETE FROM user_entitlements WHERE user_id=%s", (int(uid),))
        for ent in ents:
            ph = ",".join(["%s"] * len(ent_cols))
            rcur.execute(
                f"INSERT INTO user_entitlements ({','.join(ent_cols)}) VALUES ({ph}) ON CONFLICT DO NOTHING",
                ent,
            )
        print(f"entitlements_seeded={len(ents)}")

        # trading_settings
        cur.execute("SELECT * FROM trading_settings WHERE user_id=%s", (int(uid),))
        if cur.description:
            ts_cols = [d.name for d in cur.description]
            ts = cur.fetchone()
            if ts:
                ph = ",".join(["%s"] * len(ts_cols))
                rcur.execute("DELETE FROM trading_settings WHERE user_id=%s", (int(uid),))
                rcur.execute(
                    f"INSERT INTO trading_settings ({','.join(ts_cols)}) VALUES ({ph})",
                    ts,
                )
                print("trading_settings_seeded=configured")

        # ea_connections
        cur.execute("SELECT * FROM ea_connections WHERE user_id=%s", (int(uid),))
        if cur.description:
            ea_cols = [d.name for d in cur.description]
            eas = cur.fetchall()
            rcur.execute("DELETE FROM ea_connections WHERE user_id=%s", (int(uid),))
            for ea in eas:
                ph = ",".join(["%s"] * len(ea_cols))
                rcur.execute(
                    f"INSERT INTO ea_connections ({','.join(ea_cols)}) VALUES ({ph})",
                    ea,
                )
            print(f"ea_connections_seeded={len(eas)}")
        else:
            print("ea_connections_seeded=0")

print("seed_done")
PY

# Verify login status code only
python3 - <<'PY'
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({"email": vals['WEB_TEST_EMAIL'], "password": vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        data=json.loads(resp.read().decode())
        print('web_login=ok', 'status', resp.status, 'has_token', bool(data.get('token')))
except urllib.error.HTTPError as e:
    print('web_login=http_error', e.code)
except Exception as e:
    print('web_login=fail', type(e).__name__)
PY
