#!/usr/bin/env bash
set -euo pipefail
source /opt/aichart/web/.env
curl -sS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
  https://aichart.lork.cloud/api/cron/event-monitor | head -c 800
echo ""
