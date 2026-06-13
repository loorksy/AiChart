#!/usr/bin/env bash
set -euo pipefail
echo "=== platform config ==="
sudo -u postgres psql aichart -c "SELECT key, value FROM platform_config WHERE key IN ('AI_PROVIDER','AI_MODEL');"
echo "=== openclaw model before ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"

# Fix invalid model in DB if needed
sudo -u postgres psql aichart -c "
UPDATE platform_config SET value = 'gemini-2.5-flash', plain = true, updated_at = NOW()
WHERE key = 'AI_MODEL' AND (value LIKE '%customtools%' OR value LIKE '%-tts%');
UPDATE platform_config SET value = 'google', plain = true, updated_at = NOW()
WHERE key = 'AI_PROVIDER' AND value NOT IN ('google','anthropic','openai');
SELECT key, value FROM platform_config WHERE key IN ('AI_PROVIDER','AI_MODEL');
"

pm2 stop aichart-agent 2>/dev/null || true
sleep 2
cd /opt/aichart/web
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
export OPENCLAW_AUTO_RESTART=0
bash /opt/aichart/agent/scripts/sync-model.sh

echo "=== openclaw model after ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"

pm2 start aichart-agent --update-env
sleep 8
pm2 logs aichart-agent --lines 15 --nostream 2>&1 | tail -20
pm2 list | grep aichart-agent
