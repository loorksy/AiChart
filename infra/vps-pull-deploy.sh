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

# The admin console is a separate Flutter app served at /admin-app/, and it
# is the ONLY admin surface — the in-app panel was deleted. So it is rebuilt
# on EVERY deploy, and a deploy that cannot rebuild it STOPS here.
#
# This used to fall back to "flutter not installed — keeping the existing
# bundle", one quiet log line among fifty. That is exactly how a console
# three screens out of date kept being served for a whole release: the pull
# succeeded, the site restarted, nothing failed, and the operator opened the
# panel to find the features missing. A stale bundle is not a degraded
# deploy, it is a wrong one.
#
# It runs BEFORE the pm2 restarts on purpose: if the console cannot be built,
# the platform stays on the version it is already running rather than ending
# up half-deployed — new server, old console.
if ! command -v flutter >/dev/null 2>&1; then
  echo "" >&2
  echo "═══════════════════════════════════════════════════════════════" >&2
  echo " DEPLOY ABORTED — no flutter SDK on this host." >&2
  echo "" >&2
  echo " /admin-app/ is the platform's only admin console and must be" >&2
  echo " rebuilt from source on every deploy. Nothing was restarted;" >&2
  echo " the running version is untouched." >&2
  echo "" >&2
  echo " Install the SDK on this host, then re-run this script." >&2
  echo "═══════════════════════════════════════════════════════════════" >&2
  exit 1
fi

log "Rebuilding the admin console (/admin-app/)..."
if ! bash "$INSTALL_DIR/infra/build-admin-app.sh"; then
  echo "" >&2
  echo "═══════════════════════════════════════════════════════════════" >&2
  echo " DEPLOY ABORTED — the admin console failed to build." >&2
  echo "" >&2
  echo " Its analyze/test/build step refused, so the bundle on disk is" >&2
  echo " the OLD one and would have been served as if it were new." >&2
  echo " Nothing was restarted; the running version is untouched." >&2
  echo "═══════════════════════════════════════════════════════════════" >&2
  exit 1
fi

# Built, not assumed: the bundle must exist and carry this build's base href.
if ! grep -q 'base href="/admin-app/"' "$INSTALL_DIR/public/admin-app/index.html" 2>/dev/null; then
  echo "FATAL: /admin-app/ bundle is missing or has the wrong base href." >&2
  exit 1
fi
log "Admin console rebuilt."

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
