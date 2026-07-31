#!/usr/bin/env bash
set -uo pipefail
RC_DIR=/opt/aichart-rc-pr66-0171398
SUM=/tmp/pr66-0171398-mcp-final2-summary.txt
LOG=/tmp/pr66-0171398-mcp-final2.log
: >"$SUM"
: >"$LOG"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }

ps -eo pid,cmd | awk '/aichart-rc-pr66-0171398\/mcp/ {print $1}' | xargs -r kill 2>/dev/null || true
fuser -k 8788/tcp 2>/dev/null || true
sleep 1

# Confirm RC web still good
curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json
python3 -c 'import json;d=json.load(open("/tmp/rcw.json"));c=d.get("commit","");print("rc_web="+c);print(("PASS" if c.startswith("0171398") else "FAIL")+" rc-web-health")' | tee -a "$SUM"

cd "$RC_DIR/mcp"
# Merge secrets into .env without dropping required tokens
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/aichart-rc-pr66-0171398/mcp/.env')
# start from production mcp env for required tokens
prod=Path('/opt/aichart/mcp/.env').read_text(encoding='utf-8', errors='ignore').splitlines()
lines=list(prod)
secret=Path('/root/.config/aichart/release-test.env')
def upsert(lines, key, value):
    out=[l for l in lines if not l.startswith(key+'=')]
    out.append(f'{key}={value}')
    return out
if secret.exists():
  for line in secret.read_text().splitlines():
    if '=' in line and not line.startswith('#') and (line.startswith('MCP_TEST_') or line.startswith('WEB_TEST_')):
      k,v=line.split('=',1)
      lines=upsert(lines,k,v)
lines=upsert(lines,'MCP_PORT','8788')
lines=upsert(lines,'MCP_TEST_URL','http://127.0.0.1:8788/mcp')
lines=upsert(lines,'AICHART_API_BASE','http://127.0.0.1:3019')
# remove conflicting PORT if present
lines=[l for l in lines if not l.startswith('PORT=')]
p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
# presence only
keys=set()
for l in lines:
  if '=' in l and not l.startswith('#'): keys.add(l.split('=',1)[0])
for k in ['AICHART_SERVICE_TOKEN','MCP_PORT','MCP_TEST_EMAIL','MCP_TEST_PASSWORD','AICHART_API_BASE']:
  print(f'{k}={"configured" if k in keys else "missing"}')
PY

set -a
# shellcheck disable=SC1091
source .env
set +a
export MCP_PORT=8788
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
export AICHART_API_BASE=http://127.0.0.1:3019

nohup env MCP_PORT=8788 AICHART_API_BASE=http://127.0.0.1:3019 npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 2; done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then
  pass "rc-mcp-health"
  head -n 5 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
else
  fail "rc-mcp-health"
  tail -n 50 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
  exit 1
fi

curl -fsS http://127.0.0.1:8787/health >/tmp/prod_mcp.json
python3 -c 'import json;d=json.load(open("/tmp/prod_mcp.json"));print("prod_mcp_still="+d.get("commit","")[:12])' | tee -a "$SUM"

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
timeout 240 npm run test:tools > /tmp/mcp-tools-final2.out 2>&1
EC1=$?
tail -n 100 /tmp/mcp-tools-final2.out | tee -a "$LOG"
grep -E 'scan_market|resolve_agent|load_agent|create_recommendation|المجموع' /tmp/mcp-tools-final2.out | tee -a "$SUM" || true
[[ $EC1 -eq 0 ]] && pass "mcp-authenticated-tools" || fail "mcp-authenticated-tools"

timeout 240 npm run test:create-recommendation > /tmp/mcp-create-final2.out 2>&1
EC2=$?
cat /tmp/mcp-create-final2.out | tee -a "$LOG"
[[ $EC2 -eq 0 ]] && pass "mcp-create-recommendation" || fail "mcp-create-recommendation"

echo "=== SUMMARY ==="
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
