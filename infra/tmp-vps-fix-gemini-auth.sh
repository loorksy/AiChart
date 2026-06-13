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

# Prefer Gemini — Anthropic OAuth/key failing on gateway
sudo -u postgres psql aichart -c "
UPDATE platform_config SET value = 'google', plain = true, updated_at = NOW() WHERE key = 'AI_PROVIDER';
UPDATE platform_config SET value = 'gemini-2.5-flash', plain = true, updated_at = NOW() WHERE key = 'AI_MODEL';
SELECT key, value FROM platform_config WHERE key IN ('AI_PROVIDER','AI_MODEL');
"

export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
sed -i 's/\r$//' "$AICHART/agent/scripts/sync-model.sh"
export OPENCLAW_AUTO_RESTART=1
bash "$AICHART/agent/scripts/sync-model.sh"
bash "$AICHART/infra/vps-openclaw-telegram-reconnect.sh"

echo "=== google provider ==="
node <<'NODE'
const g = require('/root/.openclaw/openclaw.json').models.providers.google;
console.log(JSON.stringify({ baseUrl: g?.baseUrl, api: g?.api, hasKey: Boolean(g?.apiKey) }, null, 2));
NODE
echo "=== agents.defaults.model ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"
