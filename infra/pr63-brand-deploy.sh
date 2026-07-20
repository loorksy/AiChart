#!/usr/bin/env bash
# Hot-deploy brand/MCP icon fix on top of PR #63 production install.
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-local-brand-fix}"
LOG=/tmp/pr63-brand-deploy.log
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1

log() { echo "[pr63-brand] $*"; }
die() { echo "[pr63-brand] FATAL: $*" >&2; exit 1; }

[ -d "$INSTALL_DIR/web" ] || die "missing $INSTALL_DIR/web"
[ -d "$INSTALL_DIR/mcp" ] || die "missing $INSTALL_DIR/mcp"

log "Building web (brand assets + next.config redirects)"
cd "$INSTALL_DIR/web"
npm install
npm run build

log "Building MCP (OAuth favicon links)"
cd "$INSTALL_DIR/mcp"
npm ci
npm run build

log "Restarting PM2 apps"
cd "$INSTALL_DIR"
pm2 restart aichart-web aichart-worker aichart-mcp
pm2 save
sleep 8

curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/pr63_brand_web.json
curl -fsS http://127.0.0.1:8787/health | tee /tmp/pr63_brand_mcp.json
curl -fsS -o /dev/null -w "favicon_http=%{http_code}\n" http://127.0.0.1:3010/favicon-32x32.png
curl -fsS -o /dev/null -w "logo_redirect=%{http_code}\n" http://127.0.0.1:3010/logo.png || true

log "done commit=$DEPLOY_COMMIT"
