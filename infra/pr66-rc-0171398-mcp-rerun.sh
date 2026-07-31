#!/usr/bin/env bash
set -uo pipefail
RC_SHA=01713986e0892e02ef14234e242fec8d0ba5e899
RC_DIR=/opt/aichart-rc-pr66-0171398
SUM=/tmp/pr66-0171398-mcp-rerun-summary.txt
LOG=/tmp/pr66-0171398-mcp-rerun.log
: >"$SUM"
: >"$LOG"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }

# Kill only RC next on 3019, not production 3010
pkill -f 'next start -p 3019' 2>/dev/null || true
# Kill any mcp started from RC dir (not production /opt/aichart/mcp)
pkill -f '/opt/aichart-rc-pr66-0171398/mcp' 2>/dev/null || true
pkill -f 'pr66-rc-mcp' 2>/dev/null || true
sleep 2

# Ensure production MCP still up
if curl -fsS http://127.0.0.1:8787/health >/tmp/prod_mcp.json 2>/dev/null; then
  python3 -c 'import json;d=json.load(open("/tmp/prod_mcp.json"));print("prod_mcp_commit="+str(d.get("commit"))); print("prod_mcp_ok="+str(d.get("ok")))' | tee -a "$SUM"
else
  echo "WARN production MCP 8787 down — restarting production only"
  pm2 restart aichart-mcp || true
  sleep 3
fi

cd "$RC_DIR/web"
set -a; source .env; set +a
export PORT=3019 GIT_COMMIT="$RC_SHA" AICHART_DISABLE_LIVE_ORDERS=1
# Force commit in env file
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/aichart-rc-pr66-0171398/web/.env')
lines=[l for l in p.read_text().splitlines() if not l.startswith('GIT_COMMIT=') and not l.startswith('PORT=')]
lines += ['GIT_COMMIT=01713986e0892e02ef14234e242fec8d0ba5e899','PORT=3019']
p.write_text('\n'.join(lines)+'\n'); p.chmod(0o600)
PY
set -a; source .env; set +a
nohup npx next start -p 3019 -H 0.0.0.0 > /tmp/pr66-rc-web-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-web-0171398.pid
for i in $(seq 1 45); do curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rcw.json 2>/dev/null && break; sleep 2; done
python3 -c 'import json;d=json.load(open("/tmp/rcw.json"));c=d.get("commit","");print("rc_web_commit="+c);print(("PASS" if c.startswith("0171398") else "FAIL")+" rc-web-health")' | tee -a "$SUM" "$LOG"

# MCP config: force PORT=8788 via env at process start (override .env)
cd "$RC_DIR/mcp"
set -a; source .env; set +a
# Merge test secrets
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/aichart-rc-pr66-0171398/mcp/.env')
lines=p.read_text().splitlines()
secret=Path('/root/.config/aichart/release-test.env')
keep=[]
for line in lines:
    if line.startswith('PORT=') or line.startswith('MCP_TEST_URL=') or line.startswith('AICHART_API_BASE='):
        continue
    keep.append(line)
if secret.exists():
  for line in secret.read_text().splitlines():
    if line.startswith('MCP_TEST_') or line.startswith('WEB_TEST_'):
      k=line.split('=',1)[0]
      keep=[l for l in keep if not l.startswith(k+'=')]
      keep.append(line)
keep += ['PORT=8788','MCP_TEST_URL=http://127.0.0.1:8788/mcp','AICHART_API_BASE=http://127.0.0.1:3019']
p.write_text('\n'.join(keep)+'\n'); p.chmod(0o600)
print('mcp_env_rewritten')
PY

# Start with explicit PORT in environment (highest precedence)
set -a; source .env; set +a
export PORT=8788
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
export AICHART_API_BASE=http://127.0.0.1:3019
nohup env PORT=8788 npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null; then break; fi
  sleep 2
done
if curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json; then
  pass "rc-mcp-health"
  python3 -c 'import json;d=json.load(open("/tmp/rcm.json"));print("rc_mcp="+str(d))' | tee -a "$LOG"
  head -n 5 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
else
  fail "rc-mcp-health"
  tail -n 40 /tmp/pr66-rc-mcp-0171398.log | tee -a "$LOG"
fi

# Confirm prod still on 8787
curl -fsS http://127.0.0.1:8787/health >/tmp/prod_mcp2.json && python3 -c 'import json;d=json.load(open("/tmp/prod_mcp2.json"));print("prod_mcp_still="+str(d.get("commit")))' | tee -a "$SUM" || echo "FAIL prod_mcp_down" | tee -a "$SUM"

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
export MCP_TEST_EMAIL
export MCP_TEST_PASSWORD
set -a; source .env; set +a
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
timeout 240 npm run test:tools > /tmp/mcp-tools-017b.out 2>&1
EC1=$?
tail -n 80 /tmp/mcp-tools-017b.out | tee -a "$LOG"
grep -E 'scan_market|resolve_agent|load_agent|create_recommendation|المجموع' /tmp/mcp-tools-017b.out | tee -a "$SUM" || true
if [[ $EC1 -eq 0 ]]; then pass "mcp-authenticated-tools"; else fail "mcp-authenticated-tools"; fi

timeout 240 npm run test:create-recommendation > /tmp/mcp-create-017b.out 2>&1
EC2=$?
cat /tmp/mcp-create-017b.out | tee -a "$LOG"
if [[ $EC2 -eq 0 ]]; then pass "mcp-create-recommendation"; else fail "mcp-create-recommendation"; fi

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
