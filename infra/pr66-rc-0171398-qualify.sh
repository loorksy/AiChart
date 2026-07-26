#!/usr/bin/env bash
# Fresh RC + mandatory gates for PR66 head 0171398.
set -uo pipefail
RC_SHA=01713986e0892e02ef14234e242fec8d0ba5e899
RC_DIR=/opt/aichart-rc-pr66-0171398
PROD=/opt/aichart
REPO=https://github.com/loorksy/AiChart.git
LOG=/tmp/pr66-0171398-qualify.log
SUM=/tmp/pr66-0171398-qualify-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

exec > >(tee -a "$LOG") 2>&1
echo "=== QUALIFY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# --- setup ---
rm -rf "$RC_DIR"
git clone --no-checkout "$REPO" "$RC_DIR"
cd "$RC_DIR"
git fetch --all --prune
git checkout --force "$RC_SHA"
git reset --hard "$RC_SHA"
git clean -fdx
test "$(git rev-parse HEAD)" = "$RC_SHA"
test -z "$(git status --porcelain)"
git diff --check
echo "CHECKED_OUT=$(git rev-parse HEAD)"

rsync -a --delete "$PROD/web/public/charting_library/" "$RC_DIR/web/public/charting_library/"
rsync -a --delete "$PROD/web/src/vendor/tradingview/" "$RC_DIR/web/src/vendor/tradingview/"

if ! docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel; then
  REDIS_PASS=$(openssl rand -hex 16)
  echo "$REDIS_PASS" > /root/aichart-rc-redis-rel.pass
  chmod 600 /root/aichart-rc-redis-rel.pass
  docker run -d --name aichart-redis-rel --restart unless-stopped \
    -p 127.0.0.1:6380:6379 redis:7-alpine redis-server \
    --requirepass "$REDIS_PASS" --appendonly yes --appendfsync everysec --maxmemory-policy noeviction
  sleep 2
fi
REDIS_PASS=$(cat /root/aichart-rc-redis-rel.pass)

sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='aichart_rel_pr66' AND pid <> pg_backend_pid();" >/dev/null || true
sudo -u postgres dropdb --if-exists aichart_rel_pr66
sudo -u postgres createdb aichart_rel_pr66
sudo -u postgres psql -d aichart_rel_pr66 -c 'CREATE EXTENSION IF NOT EXISTS vector;'

python3 - <<'PY'
from pathlib import Path
import urllib.parse
prod=Path('/opt/aichart/web/.env').read_text()
db=[l.split('=',1)[1].strip() for l in prod.splitlines() if l.startswith('DATABASE_URL=')][0]
u=urllib.parse.urlparse(db)
parts=list(u); parts[2]='/aichart_rel_pr66'
Path('/tmp/rc_db_url').write_text(urllib.parse.urlunparse(parts))
Path('/tmp/rc_db_user').write_text(u.username or 'postgres')
print('REL_DB_READY')
PY
DB_USER=$(cat /tmp/rc_db_user)
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE aichart_rel_pr66 TO \"$DB_USER\";"
sudo -u postgres psql -d aichart_rel_pr66 -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\"; ALTER SCHEMA public OWNER TO \"$DB_USER\";"

python3 - <<'PY'
from pathlib import Path
rel_db=Path('/tmp/rc_db_url').read_text().strip()
redis_pass=Path('/root/aichart-rc-redis-rel.pass').read_text().strip()
sha='01713986e0892e02ef14234e242fec8d0ba5e899'
lines=[]
for line in Path('/opt/aichart/web/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='): lines.append('DATABASE_URL='+rel_db)
    elif line.startswith('REDIS_URL='): lines.append(f'REDIS_URL=redis://:{redis_pass}@127.0.0.1:6380/0')
    elif line.startswith('OPENAI_API_KEY=') or line.startswith('GIT_COMMIT=') or line.startswith('PORT='):
        continue
    else: lines.append(line)
secret=Path('/root/.config/aichart/release-test.env')
if secret.exists():
    for line in secret.read_text().splitlines():
        if not line.strip() or line.startswith('#') or '=' not in line: continue
        k=line.split('=',1)[0]
        lines=[l for l in lines if not l.startswith(k+'=')]
        lines.append(line)
for k,v in [('GIT_COMMIT',sha),('PORT','3019'),('AICHART_DISABLE_LIVE_ORDERS','1'),('FEATURE_AGENT_EXECUTION_GUARD','1'),('HOSTNAME','0.0.0.0')]:
    lines=[l for l in lines if not l.startswith(k+'=')]
    lines.append(f'{k}={v}')
p=Path('/opt/aichart-rc-pr66-0171398/web/.env'); p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
print('RC_ENV_OK')
PY

# OpenAI inject
INJECT=/opt/aichart-rc-pr66-2e1134a/web
if [[ -d "$INJECT/node_modules" ]]; then
  (
    cd "$INJECT"
    set -a; source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY)=' /opt/aichart/web/.env | sed 's/\r$//'); set +a
    npx --yes tsx -e '
import { getPlatformValueAsync } from "./src/lib/platformConfig.ts";
import fs from "fs";
(async()=>{
  const v=(await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
  if(!v){console.log("OPENAI_INJECT=missing"); process.exit(2);}
  const p="/opt/aichart-rc-pr66-0171398/web/.env";
  let lines=fs.readFileSync(p,"utf8").split(/\r?\n/).filter(l=>!l.startsWith("OPENAI_API_KEY="));
  while(lines.length&&lines.at(-1)==="") lines.pop();
  lines.push("OPENAI_API_KEY="+v);
  fs.writeFileSync(p, lines.join("\n")+"\n", {mode:0o600});
  console.log("OPENAI_INJECT=configured");
})().catch(()=>{console.log("OPENAI_INJECT=failed"); process.exit(1);});
'
  )
fi

cp -a "$PROD/mcp/.env" "$RC_DIR/mcp/.env"
chmod 600 "$RC_DIR/mcp/.env"
python3 - <<'PY'
from pathlib import Path
secret=Path('/root/.config/aichart/release-test.env')
mcp=Path('/opt/aichart-rc-pr66-0171398/mcp/.env')
lines=mcp.read_text().splitlines() if mcp.exists() else []
# Force RC MCP port 8788 to avoid colliding with production MCP on 8787
lines=[l for l in lines if not l.startswith('PORT=') and not l.startswith('MCP_TEST_')]
lines.append('PORT=8788')
if secret.exists():
  for line in secret.read_text().splitlines():
    if line.startswith('MCP_TEST_') or line.startswith('WEB_TEST_'):
      k=line.split('=',1)[0]
      lines=[l for l in lines if not l.startswith(k+'=')]
      lines.append(line)
lines=[l for l in lines if not l.startswith('MCP_TEST_URL=')]
lines.append('MCP_TEST_URL=http://127.0.0.1:8788/mcp')
# Point MCP bridge at RC web
lines=[l for l in lines if not l.startswith('AICHART_API_BASE=') and not l.startswith('WEB_BASE_URL=') and not l.startswith('BRIDGE_BASE_URL=')]
lines.append('AICHART_API_BASE=http://127.0.0.1:3019')
mcp.write_text('\n'.join(lines)+'\n'); mcp.chmod(0o600)
print('MCP_ENV_OK')
PY

# Seed test user into isolated DB (reuse prior script)
cp /tmp/pr66-seed-isolated-test-user.mjs /tmp/pr66-seed-0171398.mjs 2>/dev/null || true
# patch paths in a fresh seed file
cat > /tmp/pr66-seed-0171398.mjs <<'NODE'
import fs from "fs";
import { createRequire } from "module";
const require = createRequire("/opt/aichart-rc-pr66-0171398/web/package.json");
const pg = require("pg");
function readEnvFile(path) {
  const out = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}
async function copyTable(src, dst, table, whereSql, params) {
  const { rows } = await src.query(`SELECT * FROM ${table} WHERE ${whereSql}`, params);
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  await dst.query(`DELETE FROM ${table} WHERE ${whereSql}`, params);
  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    const ph = cols.map((_, i) => `$${i + 1}`).join(",");
    await dst.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${ph})`, values);
  }
  return rows.length;
}
const prodUrl = readEnvFile("/opt/aichart/web/.env").DATABASE_URL;
const relUrl = readEnvFile("/opt/aichart-rc-pr66-0171398/web/.env").DATABASE_URL;
const secret = readEnvFile("/root/.config/aichart/release-test.env");
const email = (secret.WEB_TEST_EMAIL || secret.MCP_TEST_EMAIL || "").toLowerCase();
const prod = new pg.Pool({ connectionString: prodUrl });
const rel = new pg.Pool({ connectionString: relUrl });
try {
  const u = await prod.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email]);
  if (!u.rows.length) throw new Error("test_user_missing");
  const user = u.rows[0];
  const uid = user.id;
  const cols = Object.keys(user);
  const values = cols.map((c) => user[c]);
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  const updates = cols.filter((c) => c !== "id").map((c) => `${c}=EXCLUDED.${c}`).join(",");
  await rel.query(`INSERT INTO users (${cols.join(",")}) VALUES (${ph}) ON CONFLICT (id) DO UPDATE SET ${updates}`, values);
  await rel.query("SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))");
  console.log("users_seeded=configured id="+uid);
  console.log("entitlements_seeded="+await copyTable(prod, rel, "user_entitlements", "user_id=$1", [uid]));
  console.log("trading_settings_seeded="+await copyTable(prod, rel, "trading_settings", "user_id=$1", [uid]));
  console.log("ea_connections_seeded="+await copyTable(prod, rel, "ea_connections", "user_id=$1", [uid]));
} finally { await prod.end(); await rel.end(); }
NODE

# --- installs & code gates ---
cd "$RC_DIR/web"
npm ci >>"$LOG" 2>&1 && pass "web-npm-ci" || fail "web-npm-ci"
cd "$RC_DIR/mcp"
npm ci >>"$LOG" 2>&1 && pass "mcp-npm-ci" || fail "mcp-npm-ci"

# init schema then seed
cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
npx tsx -e 'import { initDb } from "./src/lib/db/index.ts"; (async()=>{await initDb(); console.log("initDb_ok");})().catch(e=>{console.error(e);process.exit(1);});' >>"$LOG" 2>&1 && pass "initDb" || fail "initDb"
node /tmp/pr66-seed-0171398.mjs >>"$LOG" 2>&1 && pass "seed-test-user" || fail "seed-test-user"

npx tsx --test --test-force-exit src/lib/db/__tests__/schemaVersionContract.test.ts >>"$LOG" 2>&1 && pass "schema-version-contract" || fail "schema-version-contract"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
EXIST=(); for f in "${CHANGED[@]:-}"; do [[ -f "$f" ]] && EXIST+=("$f"); done
if [ "${#EXIST[@]}" -gt 0 ] && npx eslint "${EXIST[@]}" >>"$LOG" 2>&1; then pass "lint-changed-first-party"; else fail "lint-changed-first-party"; fi
npx tsc --noEmit >>"$LOG" 2>&1 && pass "web-tsc" || fail "web-tsc"
npm run build >>"$LOG" 2>&1 && pass "web-build" || fail "web-build"

cd "$RC_DIR/mcp"
npx tsc --noEmit >>"$LOG" 2>&1 && pass "mcp-tsc" || fail "mcp-tsc"
npm run build >>"$LOG" 2>&1 && pass "mcp-build" || fail "mcp-build"
npm run schemas:check >>"$LOG" 2>&1 && pass "mcp-schemas-check" || fail "mcp-schemas-check"
npm run test:catalog >>"$LOG" 2>&1 && pass "mcp-catalog-tests" || fail "mcp-catalog-tests"

cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
npm run test:postgres-release >>"$LOG" 2>&1 && pass "postgres-release" || fail "postgres-release"
npm run test:redis-release >>"$LOG" 2>&1 && pass "redis-release" || fail "redis-release"
npx tsx --test --test-force-exit src/lib/agent/modelFirst/__tests__/*.test.ts >>"$LOG" 2>&1 && pass "model-first-suite" || fail "model-first-suite"
npx tsx --test --test-force-exit src/lib/recommendations/__tests__/historicalCandidateE2E.test.ts >>"$LOG" 2>&1 && pass "historical-candidate-e2e" || fail "historical-candidate-e2e"
env -u OPENAI_API_KEY npm run test:ci >>"$LOG" 2>&1 && pass "web-test-ci" || fail "web-test-ci"

npm run test:provider-release > /tmp/prov017.out 2>&1 || true
python3 - <<'PY' | tee -a "$SUM" "$LOG"
from pathlib import Path
import json,re
text=Path('/tmp/prov017.out').read_text(encoding='utf-8',errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','postgresql://REDACTED',text)
idx=text.find('"schemaVersion"')
if idx<0:
    print('FAIL provider-release'); print(text[-800:]); raise SystemExit
while idx>0 and text[idx]!='{': idx-=1
depth=0; end=None
for i,ch in enumerate(text[idx:], idx):
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0: end=i+1; break
data=json.loads(text[idx:end])
for r in data['results']:
    print(f"provider_{r['provider']}={r['state']}:{r['code']}")
print('provider_ok='+str(data.get('ok')))
print('tradesExecuted='+str(data['safety']['tradesExecuted']))
print(('PASS' if data.get('ok') else 'FAIL')+' provider-release')
PY

# Start RC web on 0.0.0.0:3019 and MCP on 8788
pkill -f 'next start -p 3019' 2>/dev/null || true
pkill -f 'pr66-rc-mcp' 2>/dev/null || true
cd "$RC_DIR/web"
set -a; source .env; set +a
export PORT=3019 AICHART_DISABLE_LIVE_ORDERS=1 GIT_COMMIT="$RC_SHA"
nohup npx next start -p 3019 -H 0.0.0.0 > /tmp/pr66-rc-web-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-web-0171398.pid
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 -c 'import json;d=json.load(open("/tmp/rcw.json"));print("rc_web_commit="+d.get("commit","")); print(("PASS" if d.get("commit")=="01713986e0892e02ef14234e242fec8d0ba5e899" else "FAIL")+" rc-web-health")' | tee -a "$SUM"

cd "$RC_DIR/mcp"
set -a; source .env; set +a
export PORT=8788
nohup npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null; then pass "rc-mcp-health"; else fail "rc-mcp-health"; tail -n 40 /tmp/pr66-rc-mcp-0171398.log; fi

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
set -a; source .env; set +a
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
npm run test:tools >>"$LOG" 2>&1 && pass "mcp-authenticated-tools" || fail "mcp-authenticated-tools"
npm run test:create-recommendation >>"$LOG" 2>&1 && pass "mcp-create-recommendation" || fail "mcp-create-recommendation"

# Authenticated HTTP tracked + history pages
python3 - <<'PY' | tee -a "$SUM" "$LOG"
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({'email':vals['WEB_TEST_EMAIL'],'password':vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(req, timeout=30) as resp:
    data=json.loads(resp.read().decode()); token=data.get('token'); cookie=resp.headers.get('Set-Cookie','')
cookie_hdr=cookie.split(';')[0] if cookie else ''
ok_login=bool(token)
print(('PASS' if ok_login else 'FAIL')+' web-login')
headers={}
if token: headers['Authorization']='Bearer '+token
if cookie_hdr: headers['Cookie']=cookie_hdr
for path in ['/api/recommendations/tracked','/api/recommendations/tracked/stats','/chat','/dashboard','/signals']:
    r=urllib.request.Request('http://127.0.0.1:3019'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(f'http {path} status={resp.status}')
            if path.startswith('/api') and resp.status==200:
                print('PASS http'+path.replace('/', '-'))
    except urllib.error.HTTPError as e:
        print(f'http {path} status={e.code}')
        if e.code>=500: print('FAIL http'+path.replace('/', '-'))
PY

echo "=== SUMMARY ==="
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
grep -c '^PASS ' "$SUM" || true
grep -c '^FAIL ' "$SUM" || true
grep -c '^SKIP ' "$SUM" || true
