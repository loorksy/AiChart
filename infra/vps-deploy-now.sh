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

if [[ -f web/.env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' web/.env | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -n "${DATABASE_URL:-}" ]]; then
    log "pgvector extension"
    psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || log "pgvector warn"
  fi
fi

cd /opt/aichart/web
log "npm ci"
npm ci
log "npm run build"
npm run build

if [[ -x /opt/aichart/agent/scripts/sync-workspace.sh ]]; then
  log "sync OpenClaw workspace"
  bash /opt/aichart/agent/scripts/sync-workspace.sh || true
fi

log "pm2 restart"
pm2 restart aichart-web --update-env
pm2 restart aichart-agent --update-env 2>/dev/null || log "aichart-agent skip"
pm2 save
sleep 4

test -f src/lib/tradePostMortem.ts && log "tradePostMortem.ts OK"
test -f src/lib/committee.ts && log "committee.ts OK"
test -f src/app/command/page.tsx && log "command page OK"
curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/ || true
pm2 list | grep aichart || true
log "Done"
