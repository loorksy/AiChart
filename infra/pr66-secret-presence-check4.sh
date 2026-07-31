#!/usr/bin/env bash
# Presence-only. Never prints secret values.
set -euo pipefail

echo "host=$(hostname)"
echo "prod_symlink=$(readlink -f /opt/aichart 2>/dev/null || echo missing)"
echo "prod_commit=$(git -C /opt/aichart rev-parse HEAD 2>/dev/null || echo unknown)"
echo "web_health=$(curl -fsS http://127.0.0.1:3010/api/healthz 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("commit","?")[:40])' 2>/dev/null || echo unavailable)"

for p in 3100 3101 3020 3030 3200; do
  if curl -fsS "http://127.0.0.1:${p}/health" >/tmp/mcp_h.json 2>/dev/null; then
    python3 -c "import json;d=json.load(open('/tmp/mcp_h.json'));print('mcp_health_port=${p}_commit='+str(d.get('commit') or d.get('gitCommit') or d.get('version') or 'ok')[:40])"
    break
  fi
done

cd /opt/aichart/web

python3 - <<'PY'
from pathlib import Path
import os, subprocess, re, json

def presence(name, ok):
    print(f"{name}={'configured' if ok else 'missing'}")

env_path = Path('/opt/aichart/web/.env')
keys = {}
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8', errors='ignore').splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k,v=line.split('=',1)
        keys[k.strip()] = bool(v.strip().strip('"').strip("'"))

for k in ['OPENAI_API_KEY','MCP_TEST_EMAIL','EA_PROBE_USER_ID','EA_PROBE_USER','EA_PROBE_ACCOUNT','DATABASE_URL','REDIS_URL','WEB_TEST_EMAIL','MCP_TEST_PASSWORD']:
    presence(f'env_{k}', keys.get(k, False))

# PM2 dump presence (names only / configured)
try:
    out = subprocess.check_output(['pm2','jlist'], text=True, stderr=subprocess.DEVNULL)
    procs = json.loads(out)
    print(f"pm2_process_count={len(procs)}")
    for proc in procs:
        name = proc.get('name','?')
        env = (proc.get('pm2_env') or {}).get('env') or {}
        # also check nested
        merged = dict(env)
        for k,v in (proc.get('pm2_env') or {}).items():
            if isinstance(v,str) and k.isupper():
                merged[k]=v
        for k in ['OPENAI_API_KEY','MCP_TEST_EMAIL','EA_PROBE_USER_ID','DATABASE_URL','REDIS_URL']:
            val = merged.get(k) or (proc.get('pm2_env') or {}).get(k)
            if val:
                presence(f'pm2_{name}_{k}', True)
except Exception as e:
    print(f"pm2_check=failed:{type(e).__name__}")

# Secret file candidates (presence of keys only)
candidates = [
    '/root/aichart-secrets.env',
    '/root/.config/aichart/secrets.env',
    '/root/.config/aichart/release-test.env',
    '/etc/aichart/release-test.env',
    '/etc/aichart/secrets.env',
    '/opt/aichart-secrets/release-test.env',
    '/opt/aichart/secrets.env',
]
found=False
for f in candidates:
    p=Path(f)
    if p.is_file():
        found=True
        print(f'secret_file=present:{f}')
        text=p.read_text(encoding='utf-8', errors='ignore')
        for k in ['OPENAI_API_KEY','MCP_TEST_EMAIL','EA_PROBE_USER_ID','EA_PROBE_USER','DATABASE_URL','REDIS_URL','WEB_TEST_EMAIL']:
            m=re.search(rf'^{re.escape(k)}=(.*)$', text, re.M)
            presence(f'file_{k}', bool(m and m.group(1).strip()))
if not found:
    print('secret_file=none')

# Platform config via psql using DATABASE_URL from .env — presence only
dburl = None
for line in env_path.read_text(encoding='utf-8', errors='ignore').splitlines():
    if line.startswith('DATABASE_URL='):
        dburl=line.split('=',1)[1].strip().strip('"').strip("'")
        break
if dburl:
    os.environ['DATABASE_URL']=dburl
    try:
        import urllib.parse as up
        u=up.urlparse(dburl)
        # Use psql with connection string env
        q = """SELECT key,
               CASE WHEN value IS NULL OR btrim(value::text)='' THEN 0 ELSE 1 END AS present,
               plain
               FROM platform_config
               WHERE key IN ('OPENAI_API_KEY','METAAPI_TOKEN','ENCRYPTION_KEY')
               ORDER BY key;"""
        cmd=['psql', dburl, '-v','ON_ERROR_STOP=1','-At','-F','|','-c', q]
        out=subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
        if not out.strip():
            print('platform_OPENAI_API_KEY=missing')
            print('platform_rows=0')
        for row in out.strip().splitlines():
            parts=row.split('|')
            if len(parts)>=2:
                key, present = parts[0], parts[1]
                plain = parts[2] if len(parts)>2 else '?'
                presence(f'platform_{key}', present=='1')
                print(f'platform_{key}_plain={plain}')
    except Exception as e:
        print(f'platform_check=failed:{type(e).__name__}:{str(e)[:180]}')
else:
    print('platform_check=no_database_url')
PY

# Isolated resources
docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel && echo isolated_redis=configured || echo isolated_redis=missing
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'" 2>/dev/null | grep -q 1 && echo isolated_pg=configured || echo isolated_pg=missing

# Test users existence (emails only hashed? count of users) — do not print emails from prod
python3 - <<'PY'
import os, subprocess
from pathlib import Path
env_path = Path('/opt/aichart/web/.env')
dburl=None
for line in env_path.read_text(encoding='utf-8', errors='ignore').splitlines():
    if line.startswith('DATABASE_URL='):
        dburl=line.split('=',1)[1].strip().strip('"').strip("'")
        break
if not dburl:
    print('test_identity_probe=no_db')
else:
    try:
        # Only counts; never print emails
        out=subprocess.check_output(
            ['psql', dburl, '-At', '-c', "SELECT count(*) FROM \"User\";"],
            text=True, stderr=subprocess.STDOUT)
        print(f'prod_user_count={out.strip()}')
        # Check if dedicated release-test role naming convention exists without printing email
        out2=subprocess.check_output(
            ['psql', dburl, '-At', '-c',
             "SELECT count(*) FROM \"User\" WHERE email ILIKE '%release%' OR email ILIKE '%pr66%' OR email ILIKE '%mcp-test%' OR email ILIKE '%e2e%';"],
            text=True, stderr=subprocess.STDOUT)
        print(f'dedicated_test_user_candidates={out2.strip()}')
    except Exception as e:
        # Try users table lowercase
        try:
            out=subprocess.check_output(
                ['psql', dburl, '-At', '-c', "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename ILIKE '%user%' LIMIT 20;"],
                text=True, stderr=subprocess.STDOUT)
            print('user_tables=' + ','.join(out.strip().splitlines()))
        except Exception as e2:
            print(f'test_identity_probe=failed:{type(e2).__name__}')
PY

echo "done"
