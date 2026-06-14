#!/usr/bin/env bash
set -euo pipefail
set -a
source /opt/aichart/web/.env
set +a
export AICHART_API_URL="http://127.0.0.1:3010"
export OPENCLAW_AUTO_RESTART=1
bash /opt/aichart/agent/scripts/sync-model.sh
pm2 restart aichart-agent --update-env
sleep 5
curl -sS -H "Authorization: Bearer ${AICHART_SERVICE_TOKEN}" "${AICHART_API_URL}/api/agent/model"
echo ""
pm2 list | grep aichart
pm2 logs aichart-agent --lines 15 --nostream 2>&1 | tail -16
