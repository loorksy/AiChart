#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="/opt/aichart/web/.env"
export MT5_BRIDGE_TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
cp /tmp/Dockerfile /opt/aichart/infra/mt5/Dockerfile
cp /tmp/entrypoint.sh /opt/aichart/infra/mt5/entrypoint.sh
cd /opt/aichart/infra
docker compose stop mt5 2>/dev/null || true
docker compose rm -f mt5 2>/dev/null || true
docker compose build --no-cache mt5
docker compose up -d mt5
for i in $(seq 1 36); do
  if curl -sf -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health >/dev/null 2>&1; then
    echo "mt5 healthy"
    curl -s -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health
    echo ""
    exit 0
  fi
  sleep 10
done
echo "mt5 still unhealthy"
docker compose logs mt5 --tail 30
exit 1
