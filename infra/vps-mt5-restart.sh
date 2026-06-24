#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="/opt/aichart/web/.env"
export MT5_BRIDGE_TOKEN="$(grep -E '^#?MT5_BRIDGE_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
cd /opt/aichart/infra
docker compose build --no-cache mt5
docker compose up -d --force-recreate mt5
sleep 10
docker compose logs mt5 --tail 20
echo "=== health ==="
curl -s -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health || echo "health: FAIL"
echo ""
pm2 restart aichart-web --update-env
sleep 4
curl -fsS -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:3010/
docker compose ps mt5
