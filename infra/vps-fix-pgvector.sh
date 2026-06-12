#!/usr/bin/env bash
set -euo pipefail

log() { echo "[pgvector] $*"; }

dpkg -l | grep pgvector || apt-get install -y postgresql-16-pgvector

DATABASE_URL="$(grep -E '^DATABASE_URL=' /opt/aichart/web/.env | cut -d= -f2- | tr -d '\r')"
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
log "extension OK"

bash /opt/aichart/agent/scripts/sync-workspace.sh || true
pm2 restart aichart-web --update-env
pm2 restart aichart-agent --update-env 2>/dev/null || true
sleep 5
curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/
log "done"
