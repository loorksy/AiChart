#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
BRANCH="${BRANCH:-main}"
APP_WEB="${APP_WEB:-aichart-web}"
APP_WORKER="${APP_WORKER:-aichart-worker}"
APP_MCP="${APP_MCP:-aichart-mcp}"

log() { echo "[vps-pull] $*"; }

cd "$INSTALL_DIR"
log "Fetching and pulling $BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
log "Now at: $(git log --oneline -1)"

# App lives at repo root after the web/ → root merge.
cd "$INSTALL_DIR"
log "npm ci..."
npm ci
log "npm run build..."
npm run build

if [[ -d "$INSTALL_DIR/mcp" ]]; then
  log "mcp: npm ci + build..."
  (cd "$INSTALL_DIR/mcp" && npm ci && npm run build)
fi

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
  pm2 start npm --name "$APP_WORKER" --cwd "$INSTALL_DIR" -- run worker
fi

if pm2 describe "$APP_MCP" >/dev/null 2>&1; then
  log "Restarting $APP_MCP..."
  pm2 restart "$APP_MCP" --update-env
fi

pm2 save
log "Health check..."

if [[ -f "$INSTALL_DIR/infra/aichart.cron" ]] && { [[ -f "$INSTALL_DIR/.env" ]] || [[ -f "$INSTALL_DIR/web/.env" ]]; }; then
  log "install cron (bots + scalp + event-monitor)"
  bash "$INSTALL_DIR/infra/vps-install-cron.sh" "$INSTALL_DIR" || log "cron install warn"
fi

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "HTTP / -> %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -fsS -o /dev/null -w "HTTP /login -> %{http_code}\n" "http://127.0.0.1:${PORT}/login" || true

log "Done. $(git log --oneline -1)"
