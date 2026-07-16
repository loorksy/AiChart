#!/usr/bin/env bash
# Deploy MT5 self-hosted branch — touches only /opt/aichart + docker mt5 service
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"
BRANCH="${BRANCH:-cursor/mt5-selfhosted-4dce}"

log() { echo "[mt5-deploy] $*"; }

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

log "Step 1: fetch branch $BRANCH"
cd "$INSTALL_DIR"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" 2>/dev/null || git reset --hard "origin/$BRANCH"
log "At: $(git log --oneline -1)"

log "Step 2: build web"
cd "$WEB_DIR"
npm ci
npm run build

log "Step 3: MT5 bridge env"
if ! grep -q "^MT5_BRIDGE_TOKEN=" "$ENV_FILE" 2>/dev/null || [ -z "$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)" ]; then
  TOKEN="$(openssl rand -hex 24)"
  upsert_env "MT5_BRIDGE_TOKEN" "$TOKEN"
  log "Generated MT5_BRIDGE_TOKEN"
fi
MT5_TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
upsert_env "MT5_BRIDGE_URL" "http://127.0.0.1:18812"

log "Step 4: build & start mt5 container (~10 min first time)"
cd "$INSTALL_DIR/infra"
export MT5_BRIDGE_TOKEN="$MT5_TOKEN"
docker compose up -d --build mt5

log "Step 5: wait for shim"
for i in $(seq 1 60); do
  if curl -sf -H "X-Bridge-Token: $MT5_TOKEN" http://127.0.0.1:18812/status >/dev/null 2>&1; then
    log "MT5 shim responding"
    break
  fi
  if [ "$i" -eq 60 ]; then
    log "WARN: shim not ready after 5 min — check: docker compose logs mt5"
    docker compose logs mt5 --tail 30
  fi
  sleep 5
done

log "Step 6: restart aichart-web only"
pm2 restart aichart-web --update-env

log "Step 7: verify"
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2-)"
PORT="${PORT:-3010}"
SVC="$(grep '^AICHART_SERVICE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
echo "=== mt5 status ==="
curl -s -H "X-Bridge-Token: $MT5_TOKEN" http://127.0.0.1:18812/status | head -c 300 || echo "(not connected yet — link account from settings)"
echo ""
echo "=== web health ==="
curl -fsS -o /dev/null -w "HTTP / -> %{http_code}\n" "http://127.0.0.1:${PORT}/"
echo "=== trade/readiness bridge ==="
curl -s -H "Authorization: Bearer $SVC" \
  "http://127.0.0.1:${PORT}/api/agent/trade/readiness?market=forex&symbol=EURUSD&practice=true" |
  head -c 150
echo ""
docker compose ps mt5
pm2 list | grep -E 'aichart|NAME'
log "Done $(git log --oneline -1)"
