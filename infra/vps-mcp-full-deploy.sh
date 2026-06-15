#!/usr/bin/env bash
# Full MCP-first deploy: web build + MCP + optional OpenClaw removal + verify.
set -euo pipefail

REPO="${1:-/opt/aichart}"
cd "$REPO"

log() { echo "[mcp-full-deploy] $*"; }

log "1) web build (via vps-deploy-now or manual)"
if [[ -f "$REPO/infra/vps-deploy-now.sh" ]]; then
  bash "$REPO/infra/vps-deploy-now.sh" || {
    log "WARN: vps-deploy-now failed — continuing MCP steps"
  }
fi

log "2) OpenClaw decommission (if OPENCLAW_ENABLED=0)"
set -a
# shellcheck source=/dev/null
source "$REPO/web/.env" 2>/dev/null || true
set +a
if [[ "${OPENCLAW_ENABLED:-0}" == "0" ]]; then
  bash "$REPO/infra/vps-openclaw-decommission.sh" || log "decommission warn"
  pm2 restart aichart-web --update-env 2>/dev/null || true
fi

log "3) MCP deploy"
bash "$REPO/infra/vps-mcp-deploy.sh"

log "4) health checks"
sleep 2
curl -sf "http://127.0.0.1:${MCP_PORT:-8787}/health" | head -c 200 || log "MCP health warn"
curl -sf -o /dev/null -w "web HTTP %{http_code}\n" "http://127.0.0.1:${PORT:-3010}/api/health" 2>/dev/null || \
  curl -sf -o /dev/null -w "HTTPS %{http_code}\n" "https://aichart.lork.cloud/" || true

log "5) checklist"
test ! -d /root/.openclaw && log "OK: no ~/.openclaw" || log "INFO: ~/.openclaw exists"
pm2 list | grep -E 'aichart-web|aichart-mcp|aichart-agent' || true
log "Done — connect Claude to \${MCP_PUBLIC_URL:-https://aichart.lork.cloud/mcp}"
