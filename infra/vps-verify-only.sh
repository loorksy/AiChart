#!/usr/bin/env bash
set -uo pipefail

WEB_DIR="/opt/aichart/web"
ENV_FILE="$WEB_DIR/.env"
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)"
TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
API="http://127.0.0.1:${PORT:-3010}"
export AICHART_API_URL="$API"
export AICHART_SERVICE_TOKEN="$TOKEN"

echo "PORT=$PORT"
echo "=== sync-model retry ==="
bash /opt/aichart/agent/scripts/sync-model.sh 2>&1 || echo "sync-model FAILED exit=$?"

echo "=== pm2 stop/start aichart-agent ==="
pm2 stop aichart-agent
sleep 5
pm2 start aichart-agent --update-env
pm2 save

echo "=== risk/status ==="
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/agent/risk/status" | head -c 200
echo ""

echo "=== agent/model ==="
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/agent/model"
echo ""

echo "=== login wrong password ==="
curl -s -o /tmp/login-test.json -w "HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"password":"wrong"}' "$API/api/auth/login"
head -c 200 /tmp/login-test.json
echo ""

echo "=== login port 3000 (as in instructions) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"password":"wrong"}' "http://127.0.0.1:3000/api/auth/login" || true

echo "=== pm2 logs aichart-agent ==="
pm2 logs aichart-agent --lines 30 --nostream 2>&1 | tail -35

echo "=== pm2 logs aichart-web ==="
pm2 logs aichart-web --lines 20 --nostream 2>&1 | tail -25
