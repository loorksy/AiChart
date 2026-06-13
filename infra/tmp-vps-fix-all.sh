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

# Strip CRLF from service token in web .env
sed -i 's/\r$//' .env

export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
bash "$AICHART/agent/scripts/sync-workspace.sh" || true
sed -i 's/\r$//' "$AICHART/agent/scripts/sync-model.sh"
export OPENCLAW_AUTO_RESTART=1
bash "$AICHART/agent/scripts/sync-model.sh"
bash "$AICHART/infra/vps-openclaw-telegram-reconnect.sh"

echo "=== model ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"

echo "=== chart token test ==="
KEY=$(curl -sf -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$AICHART_API_URL/api/agent/model" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).ref")
echo "platform ref: $KEY"

# quick capture smoke (may 503 if playwright off — ok)
CAP=$(curl -sf -X POST -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","interval":"1h"}' "$AICHART_API_URL/api/agent/chart/binance-capture" 2>/dev/null || echo '{}')
echo "$CAP" | node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify({ok:j.ok, has_telegram:!!j.chart_url_telegram, telegram_has_token:j.chart_url_telegram?.includes('token=')},null,2))" 2>/dev/null || echo "capture skipped"

if echo "$CAP" | grep -q chart_url_telegram; then
  TGURL=$(echo "$CAP" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).chart_url_telegram")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$TGURL")
  echo "chart_url_telegram HTTP: $CODE (expect 200)"
fi
