#!/usr/bin/env bash
set -uo pipefail
RC_SHA=01713986e0892e02ef14234e242fec8d0ba5e899
RC_DIR=/opt/aichart-rc-pr66-0171398
SUM=/tmp/pr66-0171398-mcp-final-summary.txt
LOG=/tmp/pr66-0171398-mcp-final.log
: >"$SUM"
: >"$LOG"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }

# Free 3019
fuser -k 3019/tcp 2>/dev/null || true
pkill -f 'next start -p 3019' 2>/dev/null || true
# Kill RC MCP processes only (cwd under rc)
ps -eo pid,cmd | awk '/aichart-rc-pr66-0171398\/mcp/ {print $1}' | xargs -r kill 2>/dev/null || true
sleep 2

# Production MCP must stay on 8787
curl -fsS http://127.0.0.1:8787/health >/tmp/prod_mcp.json
python3 -c 'import json;d=json.load(open("/tmp/prod_mcp.json"));print("prod_mcp="+d.get("commit","")[:12])' | tee -a "$SUM"

cd "$RC_DIR/web"
test -d .next || { echo "missing .next — rebuilding"; npm run build >>"$LOG" 2>&1; }
export GIT_COMMIT="$RC_SHA" PORT=3019 AICHART_DISABLE_LIVE_ORDERS=1
nohup env GIT_COMMIT="$RC_SHA" PORT=3019 npx next start -p 3019 -H 0.0.0.0 > /tmp/pr66-rc-web-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-web-0171398.pid
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 - <<'PY' | tee -a "$SUM" "$LOG"
import json
d=json.load(open('/tmp/rcw.json'))
c=d.get('commit','')
print('rc_web_commit='+c)
print(('PASS' if c.startswith('0171398') else 'FAIL')+' rc-web-health')
PY

cd "$RC_DIR/mcp"
# MCP reads MCP_PORT, not PORT
export MCP_PORT=8788
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
export AICHART_API_BASE=http://127.0.0.1:3019
set -a
# shellcheck disable=SC1091
source <(grep -E '^(MCP_TEST_|AUTH_|DATABASE_|ENCRYPTION_|APP_SECRET|JWT)' .env | sed 's/\r$//' || true)
source /root/.config/aichart/release-test.env
set +a
export MCP_PORT=8788 MCP_TEST_URL=http://127.0.0.1:8788/mcp AICHART_API_BASE=http://127.0.0.1:3019

nohup env MCP_PORT=8788 AICHART_API_BASE=http://127.0.0.1:3019 npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then
  pass "rc-mcp-health"
  head -n 3 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
else
  fail "rc-mcp-health"
  tail -n 40 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
  exit 1
fi

# Ensure prod still 8787
curl -fsS http://127.0.0.1:8787/health >/tmp/prod_mcp2.json
python3 -c 'import json;d=json.load(open("/tmp/prod_mcp2.json"));print("prod_mcp_still="+d.get("commit","")[:12])' | tee -a "$SUM"

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
timeout 240 npm run test:tools > /tmp/mcp-tools-final.out 2>&1
EC1=$?
tail -n 90 /tmp/mcp-tools-final.out | tee -a "$LOG"
grep -E 'scan_market|resolve_agent|load_agent|create_recommendation|المجموع' /tmp/mcp-tools-final.out | tee -a "$SUM" || true
[[ $EC1 -eq 0 ]] && pass "mcp-authenticated-tools" || fail "mcp-authenticated-tools"

timeout 240 npm run test:create-recommendation > /tmp/mcp-create-final.out 2>&1
EC2=$?
cat /tmp/mcp-create-final.out | tee -a "$LOG"
[[ $EC2 -eq 0 ]] && pass "mcp-create-recommendation" || fail "mcp-create-recommendation"

echo "=== SUMMARY ==="
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
