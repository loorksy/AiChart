#!/usr/bin/env bash
set -uo pipefail
RC=/opt/aichart-rc-pr66-0171398

echo "== running mcp env =="
PID=$(ss -lntp | awk '/:8788/ {match($0,/pid=([0-9]+)/,a); print a[1]; exit}')
echo "pid=$PID"
if [[ -n "${PID:-}" ]]; then
  tr '\0' '\n' < /proc/$PID/environ | grep -E '^(AICHART_API_URL|AICHART_API_BASE|MCP_PORT|PORT|NODE_ENV)=' || true
  ls -l /proc/$PID/cwd
fi

echo "== mcp .env api url =="
grep -E '^(AICHART_API_URL|AICHART_API_BASE|MCP_PORT)=' "$RC/mcp/.env" || true

echo "== restart MCP with forced AICHART_API_URL=http://127.0.0.1:3019 =="
ps -eo pid,cmd | awk '/aichart-rc-pr66-0171398\/mcp/ {print $1}' | xargs -r kill 2>/dev/null || true
fuser -k 8788/tcp 2>/dev/null || true
sleep 1

cd "$RC/mcp"
# MCP loadConfig reads AICHART_API_URL (not AICHART_API_BASE).
python3 - <<'PY'
from pathlib import Path
p = Path("/opt/aichart-rc-pr66-0171398/mcp/.env")
lines = []
for line in p.read_text().splitlines():
    if line.startswith("AICHART_API_BASE=") or line.startswith("AICHART_API_URL=") or line.startswith("PORT=") or line.startswith("MCP_PORT=") or line.startswith("MCP_TEST_URL="):
        continue
    lines.append(line)
lines += [
    "MCP_PORT=8788",
    "MCP_TEST_URL=http://127.0.0.1:8788/mcp",
    "AICHART_API_URL=http://127.0.0.1:3019",
]
p.write_text("\n".join(lines) + "\n")
print("wrote env overrides using AICHART_API_URL")
PY

set -a
# shellcheck disable=SC1091
source .env
set +a
export MCP_PORT=8788
export AICHART_API_URL=http://127.0.0.1:3019
export MCP_TEST_URL=http://127.0.0.1:8788/mcp
echo "exported AICHART_API_URL=$AICHART_API_URL MCP_PORT=$MCP_PORT"

nohup env MCP_PORT=8788 AICHART_API_URL=http://127.0.0.1:3019 npm start > /tmp/pr66-rc-mcp-0171398.log 2>&1 &
echo $! > /tmp/pr66-rc-mcp-0171398.pid
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:8788/health >/tmp/rcm.json 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:8788/health | tee /tmp/rcm.json
echo
NEWPID=$(ss -lntp | awk '/:8788/ {match($0,/pid=([0-9]+)/,a); print a[1]; exit}')
echo "new_pid=$NEWPID"
tr '\0' '\n' < /proc/$NEWPID/environ | grep -E '^(AICHART_API_URL|MCP_PORT)=' || true

# Confirm RC vs prod health commits
echo -n "rc_web="; curl -fsS http://127.0.0.1:3019/api/healthz; echo
echo -n "prod_web="; curl -fsS http://127.0.0.1:3010/api/healthz; echo
echo -n "prod_mcp="; curl -fsS http://127.0.0.1:8787/health; echo

export MCP_TEST_URL=http://127.0.0.1:8788/mcp
timeout 240 npm run test:create-recommendation > /tmp/mcp-create-final3.out 2>&1
EC=$?
cat /tmp/mcp-create-final3.out
echo "create_exit=$EC"

timeout 240 npm run test:tools > /tmp/mcp-tools-final3.out 2>&1
EC2=$?
tail -n 90 /tmp/mcp-tools-final3.out
echo "tools_exit=$EC2"
grep -E 'create_recommendation|resolve_agent|load_agent|scan_market|المجموع' /tmp/mcp-tools-final3.out || true
