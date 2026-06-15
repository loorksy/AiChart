#!/usr/bin/env bash
set -euo pipefail

log() { echo "[deploy] $*"; }

cd /opt/aichart
log "Before: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

log "Reset to origin/main"
git fetch origin main
git checkout main
git reset --hard origin/main
log "Now at: $(git log -1 --oneline)"

if command -v psql >/dev/null 2>&1; then
  log "pgvector extension (postgres superuser)"
  sudo -u postgres psql -d aichart -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null \
    || log "pgvector warn — install postgresql-16-pgvector if needed"
fi

cd /opt/aichart/web
log "npm ci"
npm ci
log "npm run build"
npm run build

# Tar/scp from Windows leaves CRLF — breaks bash (set: pipefail: invalid option name).
find /opt/aichart/infra /opt/aichart/agent/scripts -name '*.sh' -type f 2>/dev/null | while read -r f; do
  sed -i 's/\r$//' "$f"
  chmod +x "$f"
done

set -a
# shellcheck source=/dev/null
source /opt/aichart/web/.env 2>/dev/null || true
set +a

if [[ -f /opt/aichart/agent/scripts/sync-workspace.sh ]]; then
  if [[ "${OPENCLAW_ENABLED:-0}" != "0" ]] && [[ -f /root/.openclaw/openclaw.json ]]; then
    log "sync OpenClaw workspace"
    bash /opt/aichart/agent/scripts/sync-workspace.sh || true
  else
    log "skip OpenClaw workspace (OPENCLAW_ENABLED=0 or no config)"
  fi
fi

if [[ -f /opt/aichart/agent/scripts/sync-model.sh ]]; then
  if [[ "${OPENCLAW_ENABLED:-0}" != "0" ]] && [[ -f /root/.openclaw/openclaw.json ]]; then
    log "sync OpenClaw model (disable heartbeat, cache-ttl)"
    set -a
    # shellcheck source=/dev/null
    source /opt/aichart/web/.env 2>/dev/null || true
    set +a
    export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
    bash /opt/aichart/agent/scripts/sync-model.sh || log "sync-model warn"
  else
    log "skip sync-model (OpenClaw disabled)"
  fi
fi

if [[ -f /opt/aichart/infra/aichart.cron ]] && [[ -f /opt/aichart/web/.env ]]; then
  log "install event-monitor cron"
  CRON_SECRET="$(grep '^CRON_SECRET=' /opt/aichart/web/.env | cut -d= -f2-)"
  sed -e "s|YOUR_DOMAIN|aichart.lork.cloud|g" \
      -e "s|YOUR_CRON_SECRET|${CRON_SECRET}|g" \
    /opt/aichart/infra/aichart.cron > /etc/cron.d/aichart
  chmod 644 /etc/cron.d/aichart
fi

log "pm2 restart"
pm2 restart aichart-web --update-env
set -a
# shellcheck source=/dev/null
source /opt/aichart/web/.env 2>/dev/null || true
set +a
if [[ "${OPENCLAW_ENABLED:-0}" != "0" ]] && pm2 describe aichart-agent >/dev/null 2>&1; then
  pm2 restart aichart-agent --update-env
else
  log "skip aichart-agent (OpenClaw disabled or not installed)"
fi
if [[ -f /opt/aichart/infra/vps-mcp-deploy.sh ]]; then
  log "deploy MCP"
  bash /opt/aichart/infra/vps-mcp-deploy.sh || log "mcp deploy warn"
fi
pm2 save
sleep 4

test -f src/lib/tradePostMortem.ts && log "tradePostMortem.ts OK"
test -f src/lib/committee.ts && log "committee.ts OK"
test -f src/app/command/page.tsx && log "command page OK"
test -f src/app/api/agent/ea/diagnostics/route.ts && log "ea/diagnostics OK"
test -f src/lib/monitorRunner.ts && log "monitorRunner.ts OK"
test -f src/app/api/cron/event-monitor/route.ts && log "event-monitor OK"
grep -q event-monitor /etc/cron.d/aichart 2>/dev/null && log "cron event-monitor OK"
! grep -q '"heartbeat"' ~/.openclaw/openclaw.json 2>/dev/null && log "heartbeat disabled OK" || log "heartbeat still present — check sync-model"
test -f /opt/aichart/agent/workspace/EA_TROUBLESHOOTING.md && log "EA_TROUBLESHOOTING.md OK"
test -f /opt/aichart/ea/mt5/AiChartBridge.mq5 && log "AiChartBridge.mq5 OK"
curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/ || true
pm2 list | grep aichart || true
log "Done"
