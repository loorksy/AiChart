#!/usr/bin/env bash
# Pull the branch and restart the three pm2 apps.
#
# Kept in lockstep with the CURRENT layout: the Next.js app lives at the repo
# ROOT (the old `web/` subdirectory is gone), and every process is defined in
# infra/pm2.ecosystem.config.cjs. This script deliberately does NOT invent its
# own pm2 arguments: the previous revision launched the worker THROUGH npm,
# which is exactly the shape that left an orphaned node process holding port
# 8791 after any hard kill — pm2 tracked the shell, not the process that held
# the port, so every restart died on EADDRINUSE. The ecosystem file is the
# single definition; a first deploy starts FROM it.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
BRANCH="${BRANCH:-main}"
APP_WEB="${APP_WEB:-aichart-web}"
APP_WORKER="${APP_WORKER:-aichart-worker}"
APP_MCP="${APP_MCP:-aichart-mcp}"
ECOSYSTEM="$INSTALL_DIR/infra/pm2.ecosystem.config.cjs"

log() { echo "[vps-pull] $*"; }

cd "$INSTALL_DIR"
log "Fetching and pulling $BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
log "Now at: $(git log --oneline -1)"

log "npm ci..."
npm ci
log "npm run build..."
npm run build

# The admin console is a separate Flutter app served at /admin-app/. It is
# the ONLY admin surface — the in-app panel was deleted — so a missing bundle
# means no console at all. Build it here when the SDK is present; say so
# loudly when it is not, rather than leaving a silent 404.
if command -v flutter >/dev/null 2>&1; then
  log "Building the admin console (/admin-app/)..."
  bash "$INSTALL_DIR/infra/build-admin-app.sh"
elif [[ -f "$INSTALL_DIR/public/admin-app/index.html" ]]; then
  log "flutter not installed — keeping the existing /admin-app/ bundle"
else
  log "WARN: no flutter SDK and no /admin-app/ bundle — the admin console will 404."
  log "WARN: build it on a machine with Flutter (infra/build-admin-app.sh) and copy"
  log "WARN: public/admin-app/ across, or install the SDK on this host."
fi

# pm2: restart what is running, and start from the ecosystem file otherwise.
for app in "$APP_WEB" "$APP_WORKER" "$APP_MCP"; do
  if pm2 describe "$app" >/dev/null 2>&1; then
    log "Restarting $app..."
    pm2 restart "$app" --update-env
  else
    log "Starting $app from the ecosystem file (first deploy)..."
    pm2 start "$ECOSYSTEM" --only "$app"
  fi
done

pm2 save
log "Health check..."

if [[ -f "$INSTALL_DIR/infra/aichart.cron" ]] && [[ -f "$INSTALL_DIR/.env" ]]; then
  log "install cron (bots + scalp + event-monitor)"
  bash "$INSTALL_DIR/infra/vps-install-cron.sh" "$INSTALL_DIR" || log "cron install warn"
fi

PORT="$(grep '^PORT=' .env 2>/dev/null | cut -d= -f2- || echo 3010)"
curl -fsS -o /dev/null -w "HTTP / -> %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -fsS -o /dev/null -w "HTTP /login -> %{http_code}\n" "http://127.0.0.1:${PORT}/login" || true
curl -fsS -o /dev/null -w "HTTP /admin-app/ -> %{http_code}\n" "http://127.0.0.1:${PORT}/admin-app/" || true

log "Done. $(git log --oneline -1)"
