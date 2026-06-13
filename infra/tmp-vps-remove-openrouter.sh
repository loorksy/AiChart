#!/usr/bin/env bash
set -euo pipefail
AICHART=/opt/aichart
cd "$AICHART"
git fetch origin main
git reset --hard origin/main
cd "$AICHART/web"
npm install
npm run build

# Migrate legacy openrouter provider → google
sudo -u postgres psql aichart -c "
UPDATE platform_config SET value = 'google', plain = true, updated_at = NOW()
WHERE key = 'AI_PROVIDER' AND value IN ('openrouter', 'gemini');
UPDATE platform_config SET value = 'gemini-2.5-flash', plain = true, updated_at = NOW()
WHERE key = 'AI_MODEL' AND (value LIKE '%-tts%' OR value = '' OR value IS NULL);
SELECT key, value FROM platform_config WHERE key IN ('AI_PROVIDER','AI_MODEL');
"

pm2 restart aichart-web --update-env
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
sed -i 's/\r$//' "$AICHART/agent/scripts/sync-model.sh"
export OPENCLAW_AUTO_RESTART=1
bash "$AICHART/agent/scripts/sync-model.sh"
bash "$AICHART/infra/vps-openclaw-telegram-reconnect.sh"

echo "=== agents.defaults.model ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"
echo "=== models.providers keys ==="
node -pe "Object.keys(require('/root/.openclaw/openclaw.json').models.providers||{}).join(', ')"
grep -i openrouter /root/.openclaw/openclaw.json && echo "WARNING openrouter found" || echo "no openrouter in config"
pm2 list | grep aichart
