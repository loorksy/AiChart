#!/usr/bin/env bash
set -euo pipefail
sudo -u postgres psql aichart -c "INSERT INTO platform_config (key, value, plain, updated_at) VALUES ('AI_MODEL', 'gemini-2.5-flash', true, NOW()) ON CONFLICT(key) DO UPDATE SET value = 'gemini-2.5-flash', plain = true, updated_at = NOW();"
sudo -u postgres psql aichart -c "SELECT key, value FROM platform_config WHERE key IN ('AI_MODEL','AI_PROVIDER');"
cd /opt/aichart/web
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' .env | cut -d= -f2- | tr -d '\r')"
bash /opt/aichart/agent/scripts/sync-workspace.sh
sed -i 's/\r$//' /opt/aichart/agent/scripts/sync-model.sh
export OPENCLAW_AUTO_RESTART=1
bash /opt/aichart/agent/scripts/sync-model.sh
pm2 restart aichart-web --update-env
sleep 2
echo "=== openclaw model ==="
node -pe "JSON.stringify(require('/root/.openclaw/openclaw.json').agents.defaults.model,null,2)"
echo "=== models keys ==="
node -pe "Object.keys(require('/root/.openclaw/openclaw.json').agents.defaults.models).join(', ')"
echo "=== google catalog ==="
node -pe "(require('/root/.openclaw/openclaw.json').models.providers.google.models).map(m=>m.id).join(', ')"
grep -i gemma /root/.openclaw/openclaw.json && echo "WARNING gemma found" || echo "no gemma"
grep -i tts /root/.openclaw/openclaw.json && echo "WARNING tts found" || echo "no tts in config grep"
pm2 list | grep aichart
pm2 logs aichart-agent --lines 10 --nostream 2>&1 | tail -15
