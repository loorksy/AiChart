#!/usr/bin/env bash
set -euo pipefail
LOG=/tmp/pr66-4a817d0-gates.log
RC=/opt/aichart-rc-pr66-4a817d0

echo "===== LINT CHANGED ====="
# re-run quickly for detail
cd "$RC/web"
mapfile -t CHANGED < <(git -C "$RC" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
echo "count=${#CHANGED[@]}"
npx eslint "${CHANGED[@]}" 2>&1 | tail -n 80 || true

echo "===== POSTGRES RELEASE (rerun tail) ====="
set -a; source .env; set +a
export AICHART_DISABLE_LIVE_ORDERS=1
npm run test:postgres-release 2>&1 | tail -n 100 || true

echo "===== PROVIDER RELEASE (rerun tail) ====="
npm run test:provider-release 2>&1 | tail -n 100 || true

echo "===== MCP CATALOG ====="
cd "$RC/mcp"
npm test 2>&1 | tail -n 80 || true

echo "===== WEB TEST:CI FAILING TEST ====="
# extract fail context from log
rg -n "not ok |fail |Error:|AssertionError|FAIL " "$LOG" | tail -n 80 || true
# find the failing subtest near end
python3 - <<'PY'
from pathlib import Path
text=Path('/tmp/pr66-4a817d0-gates.log').read_text(encoding='utf-8', errors='ignore')
# find not ok lines
for i,line in enumerate(text.splitlines()):
    if line.startswith('not ok') or 'fail 1' in line or line.startswith('# fail'):
        start=max(0,i-30); end=min(len(text.splitlines()), i+10)
        print('\n'.join(text.splitlines()[start:end]))
        print('---')
PY
