#!/usr/bin/env bash
set -euo pipefail
AICHART=/opt/aichart
cd "$AICHART"
git fetch origin main
git reset --hard origin/main
cd "$AICHART/web"
npm install
npm run build
pm2 restart aichart-web --update-env
sleep 3
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
echo "=== API model payload ==="
curl -sf -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$AICHART_API_URL/api/agent/model" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2)"
sed -i 's/\r$//' "$AICHART/agent/scripts/sync-model.sh"
export OPENCLAW_AUTO_RESTART=1
bash "$AICHART/agent/scripts/sync-model.sh"
bash "$AICHART/infra/vps-openclaw-telegram-reconnect.sh"
echo "=== agents.defaults.model ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"
echo "=== models.providers keys ==="
node -pe "Object.keys(require('/root/.openclaw/openclaw.json').models.providers||{}).join(', ')"
grep -i openrouter /root/.openclaw/openclaw.json && echo "WARNING openrouter found" || echo "no openrouter in config"
