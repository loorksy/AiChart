#!/usr/bin/env bash
# Clean pull + rebuild AiChart (web + mt5). Touches only /opt/aichart.
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"

log() { echo "[clean-deploy] $*"; }

log "1) reset repo to origin/main"
cd "$INSTALL_DIR"
git fetch origin
git reset --hard origin/main
git clean -fd
# Patched MT5 files (uploaded to /tmp before this script runs).
[ -f /tmp/Dockerfile ] && cp /tmp/Dockerfile "$INSTALL_DIR/infra/mt5/Dockerfile"
[ -f /tmp/entrypoint.sh ] && cp /tmp/entrypoint.sh "$INSTALL_DIR/infra/mt5/entrypoint.sh"
log "commit: $(git log --oneline -1)"

log "2) ensure MT5 bridge env"
FOREX_MODE="$(grep '^FOREX_BACKEND=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
if [[ "${FOREX_MODE,,}" == "ea" || "${FOREX_MODE,,}" == "mt_ea" ]]; then
  log "FOREX_BACKEND=ea — skip MT5 bridge (use EA on Windows VPS)"
else
  upsert() {
    local k="$1" v="$2"
    if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
    else
      echo "${k}=${v}" >>"$ENV_FILE"
    fi
  }
  if ! grep -q "^MT5_BRIDGE_TOKEN=" "$ENV_FILE" 2>/dev/null || [ -z "$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)" ]; then
    upsert "MT5_BRIDGE_TOKEN" "$(openssl rand -hex 24)"
    log "generated MT5_BRIDGE_TOKEN"
  fi
  upsert "MT5_BRIDGE_URL" "http://127.0.0.1:18812"
fi

log "3) build web"
cd "$WEB_DIR"
npm ci
npm run build

log "4) restart aichart-web"
pm2 restart aichart-web --update-env

if [[ "${FOREX_MODE,,}" == "ea" || "${FOREX_MODE,,}" == "mt_ea" ]]; then
  log "5) skip mt5 container (FOREX_BACKEND=ea)"
  cd "$INSTALL_DIR/infra"
  docker compose stop mt5 2>/dev/null || true
else
log "5) rebuild mt5 container"
export MT5_BRIDGE_TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
cd "$INSTALL_DIR/infra"
docker compose stop mt5 2>/dev/null || true
docker compose rm -f mt5 2>/dev/null || true
docker compose build --no-cache mt5
docker compose up -d mt5

log "6) wait for shim"
for i in $(seq 1 36); do
  if curl -sf -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health >/dev/null 2>&1; then
    log "mt5 shim healthy"
    curl -s -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health
    echo ""
    break
  fi
  [ "$i" -eq 36 ] && { log "WARN: mt5 not healthy yet"; docker compose logs mt5 --tail 25; }
  sleep 10
done
fi

PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://127.0.0.1:${PORT}/"
docker compose ps mt5
pm2 list | grep -E 'aichart|NAME'
log "done"
