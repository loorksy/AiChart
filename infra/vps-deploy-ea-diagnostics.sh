#!/usr/bin/env bash
set -euo pipefail

log() { echo "[ea-diagnostics] $*"; }

cd /opt/aichart/web
log "npm run build"
npm run build

log "sync OpenClaw workspace"
bash /opt/aichart/agent/scripts/sync-workspace.sh

pm2 restart aichart-web --update-env
pm2 restart aichart-agent --update-env 2>/dev/null || true
pm2 save
sleep 3

test -f /opt/aichart/agent/workspace/EA_TROUBLESHOOTING.md && log "EA_TROUBLESHOOTING.md OK"
test -f /opt/aichart/web/src/app/api/agent/ea/diagnostics/route.ts && log "diagnostics route OK"
curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/
log "done — recompile AiChartBridge.mq5 v1.02 on Windows MT5"
