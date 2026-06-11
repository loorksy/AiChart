#!/usr/bin/env bash
set -euo pipefail

AICHART="${AICHART:-/opt/aichart}"
log() { echo "[vps-sync] $*"; }

cd "$AICHART"

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  log "stashing local VPS changes"
  git stash push -u -m "vps-sync-$(date +%Y%m%d-%H%M%S)" || true
fi

log "pulling origin/main"
git fetch origin
git pull --ff-only origin main
log "now at $(git log -1 --oneline)"

log "building web"
cd "$AICHART/web"
npm run build

log "openclaw control ui + env sync"
bash "$AICHART/infra/vps-openclaw-control-ui.sh"

log "nginx openclaw (idempotent)"
bash "$AICHART/infra/vps-nginx-openclaw.sh" || log "nginx-openclaw skipped or failed — check manually"

log "restart web"
pm2 restart aichart-web --update-env

log "smoke tests"
curl -sI "https://aichart.lork.cloud/openclaw/" | head -3
curl -sI "https://aichart.lork.cloud/agent/console" | head -3
pm2 list | grep aichart || true
log "done"
