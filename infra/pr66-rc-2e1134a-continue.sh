#!/usr/bin/env bash
# Continue qualification: diagnose test:ci, start RC servers, rerun MCP auth.
set -uo pipefail
RC_DIR=/opt/aichart-rc-pr66-2e1134a
LOG=/tmp/pr66-2e1134a-continue.log
SUM=/tmp/pr66-2e1134a-continue-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

echo "=== test:ci failure extract ===" | tee -a "$LOG"
python3 - <<'PY' | tee -a "$LOG"
from pathlib import Path
text=Path('/tmp/pr66-2e1134a-gates.log').read_text(encoding='utf-8', errors='ignore')
lines=text.splitlines()
for i,line in enumerate(lines):
    if line.startswith('not ok') or 'subtests failed' in line or line.startswith('# fail'):
        start=max(0,i-25); end=min(len(lines), i+15)
        print('\n'.join(lines[start:end]))
        print('-----')
PY

echo "=== EA connection inventory (counts only) ===" | tee -a "$LOG"
python3 - <<'PY' | tee -a "$LOG"
import subprocess
from pathlib import Path
db=None
for line in Path('/opt/aichart/web/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        db=line.split('=',1)[1].strip().strip('"').strip("'"); break
for q,label in [
    ("SELECT count(*) FROM ea_connections;", "ea_connections_total"),
    ("SELECT count(*) FROM ea_connections WHERE coalesce(status,'') <> 'revoked';", "ea_connections_active"),
    ("SELECT count(*) FROM ea_connections WHERE user_id=3;", "ea_connections_user3"),
]:
    out=subprocess.check_output(['psql',db,'-At','-c',q], text=True).strip()
    print(f"{label}={out}")
PY

# Determine production MCP listen port from process
echo "=== prod MCP listen ===" | tee -a "$LOG"
ss -lntp 2>/dev/null | grep -E 'aichart|node' | head -30 | tee -a "$LOG" || true
pm2 show aichart-mcp 2>/dev/null | grep -E 'script|cwd|status|PORT|exec' | head -20 | tee -a "$LOG" || true
# inspect mcp .env for PORT without printing secrets
python3 - <<'PY' | tee -a "$LOG"
from pathlib import Path
for p in [Path('/opt/aichart/mcp/.env'), Path('/opt/aichart-rc-pr66-2e1134a/mcp/.env')]:
    if not p.exists():
        continue
    port=None
    for line in p.read_text(encoding='utf-8', errors='ignore').splitlines():
        if line.startswith('PORT=') or line.startswith('MCP_PORT=') or line.startswith('HOST_PORT='):
            port=line.split('=',1)[1].strip()
            print(f"{p}:port_key={line.split('=',1)[0]}=configured value_len={len(port)}")
    # never print value if it looks like a secret; PORT is fine to print
    for line in p.read_text(encoding='utf-8', errors='ignore').splitlines():
        if line.startswith('PORT='):
            print(f"{p}:PORT={line.split('=',1)[1].strip()}")
PY

cd "$RC_DIR/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1
export PORT=3019
export GIT_COMMIT=2e1134aba42136af3e2a810dec5ca09175414529

# Start RC web if not listening
if ! curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rc_web_health.json 2>/dev/null; then
  echo "=== starting RC web on 3019 ===" | tee -a "$LOG"
  # Prefer next start from build
  if [[ -d .next ]]; then
    nohup npx next start -p 3019 -H 127.0.0.1 > /tmp/pr66-rc-web-3019.log 2>&1 &
    echo $! > /tmp/pr66-rc-web-3019.pid
  else
    fail "rc-web-no-build"
  fi
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rc_web_health.json 2>/dev/null; then
      break
    fi
    sleep 2
  done
fi
if curl -fsS http://127.0.0.1:3019/api/healthz >/tmp/rc_web_health.json 2>/dev/null; then
  python3 -c 'import json;d=json.load(open("/tmp/rc_web_health.json"));print("rc_web_commit="+str(d.get("commit")))' | tee -a "$LOG" "$SUM"
  pass "rc-web-health"
else
  fail "rc-web-health"
  tail -n 40 /tmp/pr66-rc-web-3019.log | tee -a "$LOG" || true
fi

# Start RC MCP on 8787 (isolated) if package supports it
cd "$RC_DIR/mcp"
set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a
export PORT=8787
export MCP_TEST_URL=http://127.0.0.1:8787/mcp
# merge test creds presence into env file already done
if ! curl -fsS http://127.0.0.1:8787/health >/tmp/rc_mcp_health.json 2>/dev/null; then
  echo "=== starting RC MCP on 8787 ===" | tee -a "$LOG"
  nohup npm start > /tmp/pr66-rc-mcp-8787.log 2>&1 &
  echo $! > /tmp/pr66-rc-mcp-8787.pid
  for i in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:8787/health >/tmp/rc_mcp_health.json 2>/dev/null; then break; fi
    sleep 2
  done
fi
if curl -fsS http://127.0.0.1:8787/health >/tmp/rc_mcp_health.json 2>/dev/null; then
  pass "rc-mcp-health"
  python3 -c 'import json;d=json.load(open("/tmp/rc_mcp_health.json"));print("rc_mcp_keys="+str(sorted(d.keys())[:12]))' | tee -a "$LOG"
else
  fail "rc-mcp-health"
  tail -n 50 /tmp/pr66-rc-mcp-8787.log | tee -a "$LOG" || true
fi

# Point MCP test URL correctly
python3 - <<'PY'
from pathlib import Path
for p in [Path('/opt/aichart-rc-pr66-2e1134a/mcp/.env'), Path('/root/.config/aichart/release-test.env')]:
    if not p.exists(): continue
    lines=[l for l in p.read_text().splitlines() if not l.startswith('MCP_TEST_URL=')]
    lines.append('MCP_TEST_URL=http://127.0.0.1:8787/mcp')
    p.write_text('\n'.join(lines)+'\n')
    p.chmod(0o600)
print('MCP_TEST_URL=updated')
PY

cd "$RC_DIR/mcp"
set -a
# shellcheck disable=SC1091
source .env
set +a
export MCP_TEST_URL=http://127.0.0.1:8787/mcp
echo "=== mcp test:tools rerun ===" | tee -a "$LOG"
if npm run test:tools >>"$LOG" 2>&1; then pass "mcp-authenticated-tools"; else fail "mcp-authenticated-tools"; tail -n 60 "$LOG" | tee -a /tmp/pr66-mcp-tools-tail.txt; fi

# Re-run only failing unit suite pieces for diagnosis
cd "$RC_DIR/web"
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
echo "=== version + observability + decision unit spot ===" | tee -a "$LOG"
npx tsx --test --test-force-exit src/lib/__tests__/version.test.ts >>"$LOG" 2>&1 && pass "version-test" || fail "version-test"
npx tsx --test --test-force-exit src/lib/__tests__/observability.test.ts >>"$LOG" 2>&1 && pass "observability-test" || fail "observability-test"

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
