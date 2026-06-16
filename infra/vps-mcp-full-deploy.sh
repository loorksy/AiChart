#!/usr/bin/env bash
# Full MCP deploy: web build + MCP + verify.
set -euo pipefail

REPO="${1:-/opt/aichart}"
cd "$REPO"

log() { echo "[mcp-full-deploy] $*"; }

log "1) web build"
if [[ -f "$REPO/infra/vps-deploy-now.sh" ]]; then
  bash "$REPO/infra/vps-deploy-now.sh" || {
    log "WARN: vps-deploy-now failed — continuing MCP steps"
  }
fi

log "2) MCP deploy"
bash "$REPO/infra/vps-mcp-deploy.sh"

log "3) health checks"
sleep 2
curl -sf "http://127.0.0.1:${MCP_PORT:-8787}/health" | head -c 200 || log "MCP health warn"
curl -sf -o /dev/null -w "web HTTP %{http_code}\n" "http://127.0.0.1:${PORT:-3010}/" 2>/dev/null || true

log "4) pm2"
pm2 list | grep -E 'aichart-web|aichart-mcp' || true
log "Done — connect Claude to \${MCP_PUBLIC_URL:-https://aichart.lork.cloud/mcp}"
