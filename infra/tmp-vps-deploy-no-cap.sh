#!/usr/bin/env bash
set -euo pipefail
AICHART=/opt/aichart
cd $AICHART
git fetch origin main
git reset --hard origin/main
cd $AICHART/web
npm install
npm run build
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
sed -i 's/\r$//' $AICHART/agent/scripts/sync-model.sh
export OPENCLAW_AUTO_RESTART=1
bash $AICHART/agent/scripts/sync-model.sh
pm2 restart aichart-web --update-env
bash $AICHART/infra/vps-openclaw-telegram-reconnect.sh
echo "=== maxTokens check ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.models,null,2)"
