#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
BRANCH="${BRANCH:-main}"
APP_WEB="${APP_WEB:-aichart-web}"
APP_AGENT="${APP_AGENT:-aichart-agent}"
APP_WORKER="${APP_WORKER:-aichart-worker}"

log() { echo "[vps-pull] $*"; }

cd "$INSTALL_DIR"
log "Fetching and pulling $BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
log "Now at: $(git log --oneline -1)"

cd "$INSTALL_DIR/web"
log "npm ci..."
npm ci
log "npm run build..."
npm run build

if pm2 describe "$APP_WEB" >/dev/null 2>&1; then
  log "Restarting $APP_WEB..."
  pm2 restart "$APP_WEB" --update-env
else
  log "WARN: $APP_WEB not in PM2 — skipping web restart"
fi

if pm2 describe "$APP_WORKER" >/dev/null 2>&1; then
  log "Restarting $APP_WORKER..."
  pm2 restart "$APP_WORKER" --update-env
else
  log "Starting $APP_WORKER (first deploy)..."
  pm2 start npm --name "$APP_WORKER" --cwd "$INSTALL_DIR/web" -- run worker
fi

if [ -x "$INSTALL_DIR/agent/scripts/sync-workspace.sh" ]; then
  log "Syncing MCP workspace..."
  bash "$INSTALL_DIR/agent/scripts/sync-workspace.sh" || true
fi

if pm2 describe "$APP_AGENT" >/dev/null 2>&1; then
  log "Restarting $APP_AGENT..."
  pm2 restart "$APP_AGENT" --update-env
fi

pm2 save
log "Health check..."
PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "HTTP / -> %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -fsS -o /dev/null -w "HTTP /login -> %{http_code}\n" "http://127.0.0.1:${PORT}/login" || true

log "Done. $(git log --oneline -1)"
