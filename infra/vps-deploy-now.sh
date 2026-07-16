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
log "stop web before build"
pm2 stop aichart-web 2>/dev/null || true
log "clean .next"
rm -rf .next
log "npm ci"
if ! npm ci; then
  log "WARN: npm ci failed — falling back to npm install"
  npm install
fi
log "npm run build"
npm run build

find /opt/aichart/infra /opt/aichart/agent/scripts -name '*.sh' -type f 2>/dev/null | while read -r f; do
  sed -i 's/\r$//' "$f"
  chmod +x "$f"
done

if [[ -f /opt/aichart/infra/aichart.cron ]] && [[ -f /opt/aichart/web/.env ]]; then
  log "install cron"
  bash /opt/aichart/infra/vps-install-cron.sh /opt/aichart || {
    CRON_SECRET="$(grep '^CRON_SECRET=' /opt/aichart/web/.env | cut -d= -f2-)"
    sed -e "s|YOUR_DOMAIN|aichart.lork.cloud|g" \
        -e "s|YOUR_CRON_SECRET|${CRON_SECRET}|g" \
      /opt/aichart/infra/aichart.cron > /etc/cron.d/aichart
    chmod 644 /etc/cron.d/aichart
  }
fi

ENV_FILE="/opt/aichart/web/.env"
FOREX_MODE="$(grep '^FOREX_BACKEND=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
if [[ "${FOREX_MODE,,}" == "ea" || "${FOREX_MODE,,}" == "mt_ea" ]]; then
  log "FOREX_BACKEND=ea — will not start MT5 Docker (use infra/vps-disable-mt5.sh)"
  cd /opt/aichart/infra
  docker compose stop mt5 2>/dev/null || true
fi

log "pm2 start"
pm2 start aichart-web --update-env 2>/dev/null || (
  cd /opt/aichart/web
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd /opt/aichart/web --update-env -- start
)
if pm2 describe aichart-worker >/dev/null 2>&1; then
  log "pm2 restart worker"
  pm2 restart aichart-worker --update-env
else
  log "starting aichart-worker (first time)"
  cd /opt/aichart/web
  pm2 start npm --name aichart-worker -- run worker
fi
if [[ -f /opt/aichart/infra/vps-mcp-deploy.sh ]]; then
  log "deploy MCP"
  bash /opt/aichart/infra/vps-mcp-deploy.sh || log "mcp deploy warn"
fi
pm2 save
sleep 4

test -f src/lib/tradePostMortem.ts && log "tradePostMortem.ts OK"
test -f src/lib/monitorRunner.ts && log "monitorRunner.ts OK"
test -f src/app/api/cron/event-monitor/route.ts && log "event-monitor OK"
grep -q event-monitor /etc/cron.d/aichart 2>/dev/null && log "cron event-monitor OK"
grep -q recommendation-sweep /etc/cron.d/aichart 2>/dev/null && log "cron recommendation-sweep OK"
curl -fsS -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/ || true
pm2 list | grep aichart || true
log "Done"
