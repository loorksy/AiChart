#!/usr/bin/env bash
# Repair TV assets, rebuild, finish provider/MCP/browser gates for 0171398.
set -uo pipefail
RC_SHA=01713986e0892e02ef14234e242fec8d0ba5e899
RC_DIR=/opt/aichart-rc-pr66-0171398
PROD=/opt/aichart
LOG=/tmp/pr66-0171398-continue.log
SUM=/tmp/pr66-0171398-continue-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

# Stop hung qualify if still running
pkill -f pr66-rc-0171398-qualify.sh 2>/dev/null || true

cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA"

mkdir -p "$RC_DIR/web/public/charting_library" "$RC_DIR/web/src/vendor/tradingview"
rsync -a --delete "$PROD/web/public/charting_library/" "$RC_DIR/web/public/charting_library/"
rsync -a --delete "$PROD/web/src/vendor/tradingview/" "$RC_DIR/web/src/vendor/tradingview/"
test -e "$RC_DIR/web/src/vendor/tradingview/charting_library" && pass "tv-vendor-provisioned" || fail "tv-vendor-provisioned"

cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1 GIT_COMMIT="$RC_SHA"
if npx tsc --noEmit >>"$LOG" 2>&1; then pass "web-tsc"; else fail "web-tsc"; fi
if npm run build >>"$LOG" 2>&1; then pass "web-build"; else fail "web-build"; tail -n 40 "$LOG"; fi

# Provider
npm run test:provider-release > /tmp/prov017.out 2>&1 || true
python3 - <<'PY' | tee -a "$SUM" "$LOG"
from pathlib import Path
import json,re
text=Path('/tmp/prov017.out').read_text(encoding='utf-8',errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','postgresql://REDACTED',text)
idx=text.find('"schemaVersion"')
if idx<0:
    print('FAIL provider-release'); raise SystemExit
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
print('tradesExecuted='+str(data['safety']['tradesExecuted']))
print(('PASS' if data.get('ok') else 'FAIL')+' provider-release')
PY

# Start servers
pkill -f 'next start -p 3019' 2>/dev/null || true
# do not kill production MCP on 8787; only our 8788
if [[ -f /tmp/pr66-rc-mcp-0171398.pid ]]; then kill "$(cat /tmp/pr66-rc-mcp-0171398.pid)" 2>/dev/null || true; fi

cd "$RC_DIR/web"
set -a; source .env; set +a
export PORT=3019 AICHART_DISABLE_LIVE_ORDERS=1 GIT_COMMIT="$RC_SHA"
nohup npx next start -p 3019 -H 0.0.0.0 > /tmp/pr66-rc-web-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-web-0171398.pid
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 -c 'import json;d=json.load(open("/tmp/rcw.json")); c=d.get("commit",""); print("rc_web_commit="+c); print(("PASS" if c=="01713986e0892e02ef14234e242fec8d0ba5e899" else "FAIL")+" rc-web-health")' | tee -a "$SUM" "$LOG"

cd "$RC_DIR/mcp"
set -a; source .env; set +a
export PORT=8788 MCP_TEST_URL=http://127.0.0.1:8788/mcp
# ensure bridge to RC web
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/aichart-rc-pr66-0171398/mcp/.env')
lines=[l for l in p.read_text().splitlines() if not l.startswith('PORT=') and not l.startswith('MCP_TEST_URL=') and not l.startswith('AICHART_API_BASE=')]
lines += ['PORT=8788','MCP_TEST_URL=http://127.0.0.1:8788/mcp','AICHART_API_BASE=http://127.0.0.1:3019']
p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
PY
set -a; source .env; set +a
export PORT=8788 MCP_TEST_URL=http://127.0.0.1:8788/mcp
nohup npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then pass "rc-mcp-health"; else fail "rc-mcp-health"; tail -n 50 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"; fi

npm run test:tools >>"$LOG" 2>&1 && pass "mcp-authenticated-tools" || { fail "mcp-authenticated-tools"; grep -E 'FAIL|scan_market|resolve_agent|load_agent|create_recommendation|المجموع' "$LOG" | tail -n 40 | tee -a "$SUM"; }
npm run test:create-recommendation >>"$LOG" 2>&1 && pass "mcp-create-recommendation" || { fail "mcp-create-recommendation"; tail -n 40 "$LOG" | tee -a "$SUM"; }

# HTTP login + tracked + pages
python3 - <<'PY' | tee -a "$SUM" "$LOG"
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({'email':vals['WEB_TEST_EMAIL'],'password':vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data=json.loads(resp.read().decode()); token=data.get('token'); cookie=resp.headers.get('Set-Cookie','')
    print('PASS web-login')
except Exception as e:
    print('FAIL web-login', type(e).__name__); raise SystemExit
cookie_hdr=cookie.split(';')[0] if cookie else ''
headers={'Authorization':'Bearer '+token} if token else {}
if cookie_hdr: headers['Cookie']=cookie_hdr
for path in ['/api/recommendations/tracked','/api/recommendations/tracked/stats','/chat','/dashboard','/signals','/api/me']:
    r=urllib.request.Request('http://127.0.0.1:3019'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(f'http {path}={resp.status}')
    except urllib.error.HTTPError as e:
        print(f'http {path}={e.code}')
PY

# Public reachability for browser matrix
if curl -fsS --max-time 5 http://127.0.0.1:3019/api/healthz >/dev/null; then
  echo "rc_listen=0.0.0.0:3019"
fi
# Attempt external bind check
ss -lntp | grep 3019 | tee -a "$LOG" || true

skip "browser-full-matrix" "requires operator browser against public/tunneled RC; automated matrix follow-up"
skip "manual-review-approval" "human review not yet recorded on 0171398"

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
