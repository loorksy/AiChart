#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
WEB_ENV="$INSTALL_DIR/web/.env"
OC_JSON="/root/.openclaw/openclaw.json"

set -a; source "$WEB_ENV"; set +a
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:${PORT:-3010}}"

echo "=== Platform model API ==="
curl -sS -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$AICHART_API_URL/api/agent/model" | head -c 500
echo ""

echo ""
echo "=== Agent model status (bridge) ==="
curl -sS -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$AICHART_API_URL/api/admin/agent-model-status" 2>/dev/null | head -c 500 || echo "admin route needs session"

echo ""
echo "=== Gateway primary vs platform ==="
node -e "
const c=require('$OC_JSON');
const primary=typeof c.agents?.defaults?.model==='string'?c.agents.defaults.model:c.agents?.defaults?.model?.primary;
console.log('gateway primary:', primary);
"

echo ""
echo "=== Workspace skill ==="
ls -la /root/.openclaw/workspace/skills/aichart-trading/SKILL.md 2>/dev/null || echo "SKILL missing"
head -5 /root/.openclaw/workspace/skills/aichart-trading/SKILL.md 2>/dev/null || true

echo ""
echo "=== Workspace AGENTS bridge vars ==="
grep -E 'AICHART_API_URL|AICHART_SERVICE' /root/.openclaw/workspace/AGENTS.md 2>/dev/null | head -3 || true

echo ""
echo "=== openclaw.json tools.exec ==="
node -e "const c=require('$OC_JSON'); console.log(JSON.stringify(c.tools?.exec||null));"

echo ""
echo "=== pm2 web env OPENCLAW ==="
pm2 env 11 2>/dev/null | grep OPENCLAW || pm2 describe aichart-web | grep -A2 'env:' || true
