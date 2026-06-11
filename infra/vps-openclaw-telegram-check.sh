#!/usr/bin/env bash
set -euo pipefail
echo "=== pm2 ==="
pm2 list | grep -E 'aichart|NAME' || true
echo "=== openclaw channels ==="
if [[ -f /root/.openclaw/openclaw.json ]]; then
  node -e "
    const c = require('/root/.openclaw/openclaw.json');
    console.log('channels:', JSON.stringify(c.channels ?? null));
    console.log('gateway:', JSON.stringify(c.gateway ?? null));
  "
else
  echo "missing /root/.openclaw/openclaw.json"
fi
echo "=== telegram webhook ==="
set -a
source /opt/aichart/web/.env
set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo ""
echo "=== openclaw .env ==="
grep -E '^(AICHART_|TELEGRAM)' /root/.openclaw/.env 2>/dev/null || true
