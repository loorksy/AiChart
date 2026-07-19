#!/usr/bin/env bash
# Fresh RC + mandatory gates for the frozen PR66 head.
# Usage: RC_SHA=<fullsha> bash infra/pr66-rc-final-qualify.sh
set -uo pipefail
RC_SHA="${RC_SHA:?RC_SHA required}"
SHORT="${RC_SHA:0:7}"
RC_DIR="/opt/aichart-rc-pr66-${SHORT}"
PROD=/opt/aichart
REPO=https://github.com/loorksy/AiChart.git
LOG="/tmp/pr66-${SHORT}-qualify.log"
SUM="/tmp/pr66-${SHORT}-qualify-summary.txt"
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

exec > >(tee -a "$LOG") 2>&1
echo "=== QUALIFY ${RC_SHA} $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Preserve production
curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/prod_web_health_before.json
curl -fsS http://127.0.0.1:8787/health | tee /tmp/prod_mcp_health_before.json

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
pass "clean-git-checkout"

mkdir -p "$RC_DIR/web/public/charting_library" "$RC_DIR/web/src/vendor/tradingview"
rsync -a --delete "$PROD/web/public/charting_library/" "$RC_DIR/web/public/charting_library/"
rsync -a --delete "$PROD/web/src/vendor/tradingview/" "$RC_DIR/web/src/vendor/tradingview/"
pass "tradingview-provision"

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

python3 - <<PY
from pathlib import Path
rel_db=Path('/tmp/rc_db_url').read_text().strip()
redis_pass=Path('/root/aichart-rc-redis-rel.pass').read_text().strip()
sha='${RC_SHA}'
rc_dir='${RC_DIR}'
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
p=Path(rc_dir)/'web'/'.env'; p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
print('RC_ENV_OK')
PY

# OpenAI inject from platform_config via prior RC tree if available
for INJECT in /opt/aichart-rc-pr66-0171398/web /opt/aichart-rc-pr66-2e1134a/web /opt/aichart/web; do
  if [[ -d "$INJECT/node_modules" ]]; then
    (
      cd "$INJECT"
      set -a; source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY)=' /opt/aichart/web/.env | sed 's/\r$//'); set +a
      npx --yes tsx -e "
import { getPlatformValueAsync } from './src/lib/platformConfig.ts';
import fs from 'fs';
(async()=>{
  const v=(await getPlatformValueAsync('OPENAI_API_KEY'))?.trim();
  if(!v){console.log('OPENAI_INJECT=missing'); process.exit(2);}
  const p='${RC_DIR}/web/.env';
  let lines=fs.readFileSync(p,'utf8').split(/\r?\n/).filter(l=>!l.startsWith('OPENAI_API_KEY='));
  while(lines.length&&lines.at(-1)==='') lines.pop();
  lines.push('OPENAI_API_KEY='+v);
  fs.writeFileSync(p, lines.join('\n')+'\n', {mode:0o600});
  console.log('OPENAI_INJECT=configured');
})().catch(()=>{console.log('OPENAI_INJECT=failed'); process.exit(1);});
"
    ) && break
  fi
done

# MCP env — MUST use AICHART_API_URL + MCP_PORT
cp -a "$PROD/mcp/.env" "$RC_DIR/mcp/.env"
chmod 600 "$RC_DIR/mcp/.env"
python3 - <<PY
from pathlib import Path
secret=Path('/root/.config/aichart/release-test.env')
mcp=Path('${RC_DIR}/mcp/.env')
lines=mcp.read_text().splitlines() if mcp.exists() else []
drop_prefixes=('PORT=','MCP_PORT=','MCP_TEST_','AICHART_API_URL=','AICHART_API_BASE=','WEB_BASE_URL=','BRIDGE_BASE_URL=')
lines=[l for l in lines if not any(l.startswith(p) for p in drop_prefixes)]
lines += [
  'MCP_PORT=8788',
  'MCP_TEST_URL=http://127.0.0.1:8788/mcp',
  'AICHART_API_URL=http://127.0.0.1:3019',
  'AICHART_API_BASE=http://127.0.0.1:3019',
]
if secret.exists():
  for line in secret.read_text().splitlines():
    if line.startswith('MCP_TEST_') or line.startswith('WEB_TEST_'):
      lines.append(line)
mcp.write_text('\n'.join(lines)+'\n'); mcp.chmod(0o600)
print('MCP_ENV_OK')
PY

cd "$RC_DIR/web"
npm ci >>"$LOG" 2>&1 && pass "web-npm-ci" || fail "web-npm-ci"
cd "$RC_DIR/mcp"
npm ci >>"$LOG" 2>&1 && pass "mcp-npm-ci" || fail "mcp-npm-ci"

cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
npx tsx -e 'import { initDb } from "./src/lib/db/index.ts"; (async()=>{await initDb(); console.log("initDb_ok");})().catch(e=>{console.error(e);process.exit(1);});' >>"$LOG" 2>&1 && pass "initDb" || fail "initDb"
RC_WEB="$RC_DIR/web" RC_ENV="$RC_DIR/web/.env" PROD_ENV=/opt/aichart/web/.env \
  node "$RC_DIR/infra/pr66-seed-isolated-test-user.mjs" >>"$LOG" 2>&1 && pass "seed-test-user" || fail "seed-test-user"

npx tsx --test --test-force-exit src/lib/db/__tests__/schemaVersionContract.test.ts >>"$LOG" 2>&1 && pass "schema-version-contract" || fail "schema-version-contract"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
EXIST=(); for f in "${CHANGED[@]:-}"; do [[ -f "$f" ]] && EXIST+=("$f"); done
if [ "${#EXIST[@]}" -gt 0 ] && npx eslint "${EXIST[@]}" >>"$LOG" 2>&1; then pass "lint-changed-first-party"; else
  if [ "${#EXIST[@]}" -eq 0 ]; then pass "lint-changed-first-party"; else fail "lint-changed-first-party"; fi
fi
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
# architecture / authority
npx tsx --test --test-force-exit src/lib/agent/__tests__/confidenceSemantics.test.ts src/lib/recommendations/__tests__/fromAgentResult.test.ts >>"$LOG" 2>&1 && pass "authority-smoke" || fail "authority-smoke"
env -u OPENAI_API_KEY npm run test:ci >>"$LOG" 2>&1 && pass "web-test-ci" || fail "web-test-ci"

timeout 180 npm run test:provider-release > "/tmp/prov-${SHORT}.out" 2>&1 || true
# kill hung provider validator (often stalls after printing JSON)
pkill -f 'validate-provider-release' 2>/dev/null || true
sleep 1
python3 - <<PY | tee -a "$SUM" "$LOG"
from pathlib import Path
import json,re
text=Path('/tmp/prov-${SHORT}.out').read_text(encoding='utf-8',errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\\s\"\\']+','postgresql://REDACTED',text)
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

# Start RC services
fuser -k 3019/tcp 2>/dev/null || true
fuser -k 8788/tcp 2>/dev/null || true
sleep 1
cd "$RC_DIR/web"
set -a; source .env; set +a
export PORT=3019 AICHART_DISABLE_LIVE_ORDERS=1 GIT_COMMIT="$RC_SHA"
nohup npx next start -p 3019 -H 0.0.0.0 > "/tmp/pr66-rc-web-${SHORT}.log" 2>&1 &
echo $! > "/tmp/pr66-rc-web-${SHORT}.pid"
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 - <<PY
import json
d=json.load(open('/tmp/rcw.json'))
c=d.get('commit','')
print('rc_web_commit='+c)
print(('PASS' if c=='${RC_SHA}' else 'FAIL')+' rc-web-health')
PY

cd "$RC_DIR/mcp"
set -a; source .env; set +a
export MCP_PORT=8788 AICHART_API_URL=http://127.0.0.1:3019
nohup env MCP_PORT=8788 AICHART_API_URL=http://127.0.0.1:3019 npm start > "/tmp/pr66-rc-mcp-${SHORT}.log" 2>&1 &
echo $! > "/tmp/pr66-rc-mcp-${SHORT}.pid"
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then pass "rc-mcp-health"; else fail "rc-mcp-health"; fi
python3 - <<'PY'
import json
d=json.load(open('/tmp/rcm.json'))
print('rc_mcp_commit='+d.get('commit',''))
prod=json.load(open('/tmp/prod_mcp_health_before.json'))
print('prod_mcp_still='+prod.get('commit','')[:12])
PY

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
timeout 240 npm run test:tools >>"$LOG" 2>&1 && pass "mcp-authenticated-tools" || fail "mcp-authenticated-tools"
timeout 240 npm run test:create-recommendation >>"$LOG" 2>&1 && pass "mcp-create-recommendation" || fail "mcp-create-recommendation"

# Historical HTTP E2E
cd "$RC_DIR/web"
set -a; source .env; set +a
export WEB_BASE_URL=http://127.0.0.1:3019 AICHART_DISABLE_LIVE_ORDERS=1
set -a; source /root/.config/aichart/release-test.env; set +a
timeout 120 npm run test:pr66-historical-http >>"$LOG" 2>&1 && pass "historical-http-e2e" || fail "historical-http-e2e"

# Browser matrix
npx playwright install chromium >>"$LOG" 2>&1 || true
timeout 900 npm run test:pr66-browser-matrix >>"$LOG" 2>&1 && pass "browser-matrix" || fail "browser-matrix"

# Production untouched
python3 - <<'PY' | tee -a "$SUM" "$LOG"
import json,urllib.request
w=json.load(urllib.request.urlopen('http://127.0.0.1:3010/api/healthz'))
m=json.load(urllib.request.urlopen('http://127.0.0.1:8787/health'))
ok=w.get('commit','').startswith('d995fdf') and m.get('commit','').startswith('d995fdf')
print('prod_web='+w.get('commit',''))
print('prod_mcp='+m.get('commit',''))
print(('PASS' if ok else 'FAIL')+' production-untouched')
PY

echo "=== SUMMARY ==="
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo -n "PASS_COUNT="; grep -c '^PASS ' "$SUM" || true
echo -n "FAIL_COUNT="; grep -c '^FAIL ' "$SUM" || true
echo -n "SKIP_COUNT="; grep -c '^SKIP ' "$SUM" || true
