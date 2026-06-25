#!/usr/bin/env bash
# Switch AiChart forex backend from MT5 Local (Docker/Wine) to EA bridge.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"

log() { echo "[ea-switch] $*"; }

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

comment_env() {
  local key="$1"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=|#${key}=|" "$ENV_FILE"
  fi
}

[[ -f "$ENV_FILE" ]] || { log "missing $ENV_FILE"; exit 1; }

log "enable FOREX_BACKEND=ea"
upsert_env "FOREX_BACKEND" "ea"

log "disable MT5 bridge (mt5local)"
comment_env "MT5_BRIDGE_URL"
comment_env "MT5_BRIDGE_TOKEN"

log "stop mt5 container (free ~1.5GB RAM)"
cd "$INSTALL_DIR/infra"
docker compose stop mt5 2>/dev/null || true

log "restart aichart-web + aichart-worker"
pm2 restart aichart-web --update-env
pm2 restart aichart-worker --update-env 2>/dev/null || true
pm2 save 2>/dev/null || true
sleep 4
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://127.0.0.1:${PORT}/"

log "done — next steps:"
echo "  1. Settings → Integrations → generate EA token"
echo "  2. Install AiChartBridge on Windows VPS (see docs/EA_WINDOWS_VPS.md)"
echo "  3. Set active_market=forex in Trading settings"
