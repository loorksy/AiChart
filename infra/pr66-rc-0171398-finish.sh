#!/usr/bin/env bash
set -uo pipefail
RC_SHA=01713986e0892e02ef14234e242fec8d0ba5e899
RC_DIR=/opt/aichart-rc-pr66-0171398
SUM=/tmp/pr66-0171398-finish-summary.txt
LOG=/tmp/pr66-0171398-finish.log
: >"$SUM"
: >"$LOG"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

pkill -f 'validate-provider-release' 2>/dev/null || true
pkill -f 'pr66-rc-0171398-continue' 2>/dev/null || true
pkill -f 'pr66-rc-0171398-qualify' 2>/dev/null || true
sleep 1

# Parse any existing provider output
for f in /tmp/prov017.out /tmp/prov2.out; do
  if [[ -f "$f" ]] && grep -q schemaVersion "$f"; then
    python3 - <<PY | tee -a "$SUM" "$LOG"
from pathlib import Path
import json,re
text=Path("$f").read_text(encoding="utf-8",errors="ignore")
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','postgresql://REDACTED',text)
idx=text.find('"schemaVersion"')
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
    break
  fi
done

# Quick non-hanging provider re-run with timeout
cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
timeout 120 npm run test:provider-release > /tmp/prov017b.out 2>&1 || true
python3 - <<'PY' | tee -a "$SUM" "$LOG"
from pathlib import Path
import json,re
p=Path('/tmp/prov017b.out')
if not p.exists():
    print('FAIL provider-release-timeout'); raise SystemExit
text=p.read_text(encoding='utf-8',errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','postgresql://REDACTED',text)
idx=text.find('"schemaVersion"')
if idx<0:
    print('FAIL provider-release-no-json'); print(text[-500:]); raise SystemExit
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

# Ensure TV + build already done from continue; start servers
pkill -f 'next start -p 3019' 2>/dev/null || true
if [[ -f /tmp/pr66-rc-mcp-0171398.pid ]]; then kill "$(cat /tmp/pr66-rc-mcp-0171398.pid)" 2>/dev/null || true; fi
sleep 1

cd "$RC_DIR/web"
set -a; source .env; set +a
export PORT=3019 AICHART_DISABLE_LIVE_ORDERS=1 GIT_COMMIT="$RC_SHA"
nohup npx next start -p 3019 -H 0.0.0.0 > /tmp/pr66-rc-web-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-web-0171398.pid
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 -c 'import json;d=json.load(open("/tmp/rcw.json"));c=d.get("commit","");print("rc_web_commit="+c);print(("PASS" if c=="01713986e0892e02ef14234e242fec8d0ba5e899" else "FAIL")+" rc-web-health")' | tee -a "$SUM" "$LOG"

cd "$RC_DIR/mcp"
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/aichart-rc-pr66-0171398/mcp/.env')
lines=[l for l in p.read_text().splitlines() if not l.startswith('PORT=') and not l.startswith('MCP_TEST_URL=') and not l.startswith('AICHART_API_BASE=')]
lines += ['PORT=8788','MCP_TEST_URL=http://127.0.0.1:8788/mcp','AICHART_API_BASE=http://127.0.0.1:3019']
# keep MCP_TEST_EMAIL/PASSWORD from secret merge if present
secret=Path('/root/.config/aichart/release-test.env')
if secret.exists():
  for line in secret.read_text().splitlines():
    if line.startswith('MCP_TEST_') or line.startswith('WEB_TEST_'):
      k=line.split('=',1)[0]
      lines=[l for l in lines if not l.startswith(k+'=')]
      lines.append(line)
p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
PY
set -a; source .env; set +a
export PORT=8788 MCP_TEST_URL=http://127.0.0.1:8788/mcp
nohup npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then pass "rc-mcp-health"; else fail "rc-mcp-health"; tail -n 30 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"; fi

timeout 180 npm run test:tools > /tmp/mcp-tools-017.out 2>&1
TOOLS_EC=$?
tail -n 60 /tmp/mcp-tools-017.out | tee -a "$LOG"
if [[ $TOOLS_EC -eq 0 ]]; then pass "mcp-authenticated-tools"; else fail "mcp-authenticated-tools"; fi
grep -E 'scan_market|resolve_agent|load_agent|create_recommendation|المجموع' /tmp/mcp-tools-017.out | tee -a "$SUM" || true

timeout 180 npm run test:create-recommendation > /tmp/mcp-create-017.out 2>&1
CREC_EC=$?
cat /tmp/mcp-create-017.out | tee -a "$LOG"
if [[ $CREC_EC -eq 0 ]]; then pass "mcp-create-recommendation"; else fail "mcp-create-recommendation"; fi

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
headers={'Authorization':'Bearer '+token} if token else {}
if cookie: headers['Cookie']=cookie.split(';')[0]
for path in ['/api/recommendations/tracked','/api/recommendations/tracked/stats','/chat','/recommendations','/signals']:
    r=urllib.request.Request('http://127.0.0.1:3019'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(f'http {path}={resp.status}')
    except urllib.error.HTTPError as e:
        print(f'http {path}={e.code}')
PY

# Carry forward already-known passes from earlier qualify/continue
for g in tv-vendor-provisioned web-tsc web-build; do
  grep -q "^PASS $g" /tmp/pr66-0171398-continue-summary.txt 2>/dev/null && echo "PASS $g" | tee -a "$SUM" || true
done
for g in postgres-release redis-release model-first-suite historical-candidate-e2e web-test-ci mcp-catalog-tests mcp-schemas-check schema-version-contract lint-changed-first-party; do
  grep -q "^PASS $g" /tmp/pr66-0171398-qualify-summary.txt 2>/dev/null && echo "PASS $g (from earlier RC run same SHA)" | tee -a "$SUM" || true
done

skip "browser-full-matrix" "multi-viewport browser automation not completed this pass"
skip "manual-review-approval" "no approved human review on 0171398"
skip "vision-matrix-independent" "not separately re-run beyond provider OpenAI gate"

echo "=== FINAL SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "HEAD=$RC_SHA"
curl -fsS http://127.0.0.1:3010/api/healthz | python3 -c 'import sys,json;print("prod_web="+json.load(sys.stdin).get("commit",""))'
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
