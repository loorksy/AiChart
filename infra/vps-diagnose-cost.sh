#!/usr/bin/env bash
set -euo pipefail

echo "=== cron ==="
cat /etc/cron.d/aichart 2>/dev/null || echo "no cron"

echo "=== openclaw model ==="
node -pe "const c=require('/root/.openclaw/openclaw.json'); JSON.stringify({primary:c.agents?.defaults?.model?.primary,heartbeat:c.agents?.defaults?.heartbeat,contextPruning:c.agents?.defaults?.contextPruning},null,2)"

echo "=== pm2 agent uptime/restarts ==="
pm2 jlist 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0)).filter(p=>p.name?.includes('aichart')).map(p=>({name:p.name,status:p.pm2_env?.status,restarts:p.pm2_env?.restart_time,uptime:p.pm2_env?.pm_uptime}))" || pm2 list | grep aichart

ENV=/opt/aichart/web/.env
DB=$(grep '^DB_PATH=' "$ENV" 2>/dev/null | cut -d= -f2- || echo "")
if [[ -z "$DB" ]]; then
  if [[ -f /opt/aichart/web/data/aichart.db ]]; then DB=/opt/aichart/web/data/aichart.db; fi
fi
if grep -q '^DATABASE_URL=' "$ENV" 2>/dev/null; then
  echo "=== event wakes 24h (postgres) ==="
  source "$ENV"
  psql "$DATABASE_URL" -t -c "SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'event_wake_%' AND created_at > NOW() - interval '24 hours' GROUP BY action ORDER BY 2 DESC;" 2>/dev/null || echo "pg query failed"
  echo "=== audit last 30 (agent related) ==="
  psql "$DATABASE_URL" -t -c "SELECT created_at, action, substr(detail,1,80) FROM audit_logs WHERE action LIKE '%wake%' OR action LIKE '%agent%' OR action LIKE '%cron%' ORDER BY created_at DESC LIMIT 30;" 2>/dev/null || true
elif [[ -n "$DB" && -f "$DB" ]]; then
  echo "=== event wakes 24h (sqlite) ==="
  sqlite3 "$DB" "SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'event_wake_%' AND created_at > datetime('now','-1 day') GROUP BY action;"
  echo "=== audit last 30 ==="
  sqlite3 "$DB" "SELECT created_at, action, substr(detail,1,80) FROM audit_logs WHERE action LIKE '%wake%' OR action LIKE '%cron%' ORDER BY created_at DESC LIMIT 30;"
fi

echo "=== telegram session sizes ==="
find /root/.openclaw/agents -name '*.jsonl' -o -name 'sessions.json' 2>/dev/null | head -20
du -sh /root/.openclaw/agents/main/sessions 2>/dev/null || true
ls -lah /root/.openclaw/agents/main/sessions 2>/dev/null | tail -10 || true

echo "=== recent openclaw log (last 40 lines with model/tokens) ==="
pm2 logs aichart-agent --lines 80 --nostream 2>/dev/null | grep -iE 'token|model|heartbeat|anthropic|rate|error|EVENT' | tail -40 || true
