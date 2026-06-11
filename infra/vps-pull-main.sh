#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"

log() { echo "[pull] $*"; }

cd "$INSTALL_DIR"
git fetch origin
git stash push -u -m "vps-local" 2>/dev/null || true
git checkout -f main
git reset --hard origin/main
log "At: $(git log --oneline -1)"

cd "$WEB_DIR"
npm ci
npm run build

log "Restart aichart-web"
pm2 restart aichart-web --update-env

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "HTTP / -> %{http_code}\n" "http://127.0.0.1:${PORT}/"
pm2 list | grep -E 'aichart|NAME'
log "Done"
