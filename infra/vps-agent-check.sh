#!/usr/bin/env bash
set -euo pipefail

echo "=== PM2 ==="
pm2 list | grep -E 'aichart|NAME' || true

echo ""
echo "=== agent error log (last 50) ==="
tail -50 /root/.pm2/logs/aichart-agent-error.log 2>/dev/null || echo "(no error log)"

echo ""
echo "=== agent out log (last 40) ==="
tail -40 /root/.pm2/logs/aichart-agent-out.log 2>/dev/null || echo "(no out log)"

echo ""
echo "=== web error log (last 20) ==="
tail -20 /root/.pm2/logs/aichart-web-error.log 2>/dev/null || echo "(no web error log)"

echo ""
echo "=== env keys (masked) ==="
grep -E '^AICHART_|^ANTHROPIC|^TELEGRAM|^OPENCLAW' /opt/aichart/web/.env 2>/dev/null | sed 's/=.*/=***/' || true
grep -E '^AICHART_|^OPENCLAW' /root/.openclaw/.env 2>/dev/null | sed 's/=.*/=***/' || true

echo ""
echo "=== API bridge ==="
TOKEN=$(grep '^AICHART_SERVICE_TOKEN=' /opt/aichart/web/.env | cut -d= -f2-)
curl -s -o /dev/null -w "mode %{http_code}\n" -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/agent/mode || true
curl -s -w "\nrisk http %{http_code}\n" -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/agent/risk/status | head -c 500
echo ""

echo ""
echo "=== openclaw config ==="
test -f /root/.openclaw/openclaw.json && echo "openclaw.json: ok" || echo "openclaw.json: MISSING"
jq -r '.agents.defaults.model.primary // "no model"' /root/.openclaw/openclaw.json 2>/dev/null || true
jq -r '.channels.telegram.enabled // "no telegram"' /root/.openclaw/openclaw.json 2>/dev/null || true

echo ""
echo "=== gateway process ==="
pgrep -af openclaw || echo "no openclaw process"
ss -tlnp | grep -E '18789|3010' || true
