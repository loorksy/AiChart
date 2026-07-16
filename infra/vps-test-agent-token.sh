#!/usr/bin/env bash
set -euo pipefail
TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' /opt/aichart/web/.env | cut -d= -f2- | tr -d '\r')"
echo "file_token_len=${#TOKEN}"
PID="$(pm2 pid aichart-web)"
tr '\0' '\n' < "/proc/$PID/environ" | grep '^AICHART_SERVICE_TOKEN=' || echo "missing in process env"
curl -s \
  "http://127.0.0.1:3010/api/agent/trade/readiness?market=forex&symbol=EURUSD&practice=true" \
  -H "Authorization: Bearer ${TOKEN}" |
  head -c 300
echo
curl -s -o /tmp/chart-test.png -w "chart:%{http_code} bytes:%{size_download}\n" -X POST \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"symbol":"EURUSD","interval":"1h","market":"forex"}' \
  "http://127.0.0.1:3010/api/agent/chart/snapshot"
