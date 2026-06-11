#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"

log() { echo "[v20] $*"; }

log "pull origin/main"
cd "$INSTALL_DIR"
git fetch origin
git reset --hard origin/main
log "at $(git log --oneline -1)"

log "build web"
cd "$WEB_DIR"
npm ci
npm run build

log "restart aichart-web"
pm2 restart aichart-web --update-env
sleep 4
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://127.0.0.1:${PORT}/"

log "rebuild mt5"
export MT5_BRIDGE_TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
cd "$INSTALL_DIR/infra"
docker compose stop mt5 2>/dev/null || true
docker compose rm -f mt5 2>/dev/null || true
docker compose build --no-cache mt5
docker compose up -d mt5

log "wait for health"
for i in $(seq 1 24); do
  if curl -sf -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health >/dev/null 2>&1; then
    log "mt5 health OK"
    curl -s -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health
    echo ""
    docker compose ps mt5
    exit 0
  fi
  sleep 10
done

log "mt5 not healthy yet"
docker compose logs mt5 --tail 30
docker compose ps mt5
exit 1
