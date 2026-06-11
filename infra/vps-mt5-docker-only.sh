#!/usr/bin/env bash
set -euo pipefail
WEB_DIR="/opt/aichart/web"
ENV_FILE="$WEB_DIR/.env"
TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
export MT5_BRIDGE_TOKEN="$TOKEN"
cd /opt/aichart/infra
echo "[mt5] building container..."
docker compose build mt5
docker compose up -d mt5
for i in $(seq 1 72); do
  if curl -sf -H "X-Bridge-Token: $TOKEN" http://127.0.0.1:18812/health >/dev/null 2>&1; then
    echo "[mt5] shim healthy"
    curl -s -H "X-Bridge-Token: $TOKEN" http://127.0.0.1:18812/health | head -c 200
    echo ""
    break
  fi
  [ "$i" -eq 72 ] && docker compose logs mt5 --tail 40
  sleep 10
done
pm2 restart aichart-web --update-env
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)"
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://127.0.0.1:${PORT:-3010}/"
docker compose ps mt5
