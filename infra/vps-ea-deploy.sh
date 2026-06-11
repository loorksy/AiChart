#!/usr/bin/env bash
# Full EA bridge deploy on Linux VPS: pull, build, switch backend, forex settings.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
cd "$INSTALL_DIR"

log() { echo "[ea-deploy] $*"; }

log "pull origin/main"
git fetch origin
git reset --hard origin/main
log "at $(git log --oneline -1)"

log "build web"
cd web
npm ci
npm run build

log "switch to EA backend"
bash "$INSTALL_DIR/infra/vps-switch-forex-ea.sh"

log "forex settings"
bash "$INSTALL_DIR/infra/vps-forex-settings.sh"

log "restart agent (HEARTBEAT + skill)"
pm2 restart aichart-agent --update-env 2>/dev/null || true

log "EA deploy complete"
