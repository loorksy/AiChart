#!/usr/bin/env bash
# Disable self-hosted MT5 Docker on Linux VPS.
# Keeps EA bridge + MetaApi + Binance. Inverse: infra/vps-enable-mt5-platform.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$INSTALL_DIR/web/.env"

log() { echo "[disable-mt5] $*"; }

[[ -f "$ENV_FILE" ]] || { log "missing $ENV_FILE"; exit 1; }

log "switch forex to EA (comment MT5 bridge env, stop container)"
bash "$SCRIPT_DIR/vps-switch-forex-ea.sh"

log "restart aichart-worker"
pm2 restart aichart-worker --update-env 2>/dev/null || log "aichart-worker not in pm2 — skip"
pm2 save 2>/dev/null || true

log "remove mt5 container (free RAM)"
cd "$INSTALL_DIR/infra"
docker compose stop mt5 2>/dev/null || true
docker compose rm -f mt5 2>/dev/null || true

log "state after disable:"
echo "  FOREX_BACKEND=$(grep '^FOREX_BACKEND=' "$ENV_FILE" | cut -d= -f2- || echo '(unset)')"
grep -E '^#?MT5_BRIDGE_' "$ENV_FILE" || echo "  (no MT5_BRIDGE_* lines)"
docker ps --format '  {{.Names}} {{.Status}}' 2>/dev/null | grep -i mt5 || echo "  (no mt5 container running)"
free -h | sed -n '1,2p' | sed 's/^/  /'

log "done — forex: EA bridge + MetaApi (Settings → Integrations). Binance unchanged."
