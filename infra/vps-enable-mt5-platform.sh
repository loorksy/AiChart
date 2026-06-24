#!/usr/bin/env bash
# Re-enable server-side MT5 (platform connect) — undoes vps-switch-forex-ea.sh.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"

log() { echo "[mt5-platform] $*"; }

upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^#?${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^#\\?${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

read_env_val() {
  local key="$1"
  grep -E "^#?${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

[[ -f "$ENV_FILE" ]] || { log "missing $ENV_FILE"; exit 1; }

log "enable platform forex (mt5local)"
upsert_env "FOREX_BACKEND" "mt5local"

TOKEN="$(read_env_val MT5_BRIDGE_TOKEN)"
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(openssl rand -hex 24)"
  log "generated MT5_BRIDGE_TOKEN"
fi
upsert_env "MT5_BRIDGE_TOKEN" "$TOKEN"
upsert_env "MT5_BRIDGE_URL" "http://127.0.0.1:18812"

log "start mt5 container"
cd "$INSTALL_DIR/infra"
export MT5_BRIDGE_TOKEN="$TOKEN"
export MT5_CONNECT_CAPABLE="${MT5_CONNECT_CAPABLE:-0}"
docker compose up -d --build mt5

log "wait for shim"
for i in $(seq 1 24); do
  if curl -sf "http://127.0.0.1:18812/health" >/dev/null 2>&1; then
    curl -s "http://127.0.0.1:18812/health"
    echo ""
    break
  fi
  [[ "$i" -eq 24 ]] && { log "WARN: shim not ready"; docker compose logs mt5 --tail 20; }
  sleep 5
done

log "restart pm2"
pm2 restart aichart-web aichart-worker --update-env 2>/dev/null || pm2 restart aichart-web --update-env
pm2 save

PORT="$(read_env_val PORT)"
PORT="${PORT:-3010}"
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://127.0.0.1:${PORT}/"
log "done — refresh /console/connect and choose «عبر المنصة»"
