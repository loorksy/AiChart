#!/usr/bin/env bash
set -euo pipefail
source /opt/aichart/web/.env

echo "=== trade_open attempts 24h ==="
psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM audit_logs WHERE action='agent_trade_open' AND created_at > NOW() - interval '24 hours';"

echo "=== cron_monitor vs event_monitor 24h ==="
psql "$DATABASE_URL" -t -c "SELECT action, COUNT(*) FROM audit_logs WHERE action IN ('cron_monitor','cron_event_monitor') AND created_at > NOW() - interval '24 hours' GROUP BY action;"

echo "=== usage_daily last 7 days ==="
psql "$DATABASE_URL" -c "SELECT date, user_id, requests, input_tokens, output_tokens FROM usage_daily ORDER BY date DESC LIMIT 14;" 2>/dev/null || psql "$DATABASE_URL" -c "SELECT * FROM usage_daily ORDER BY date DESC LIMIT 14;" 2>/dev/null || echo "no usage_daily"

echo "=== ANTHROPIC_MODEL from platform ==="
curl -sS -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" http://127.0.0.1:3010/api/agent/model

echo ""
echo "=== session dir size ==="
du -sh /root/.openclaw/agents/main/sessions
find /root/.openclaw/agents/main/sessions -name '*.jsonl' -printf '%s %p\n' 2>/dev/null | sort -rn | head -8

echo "=== listUsersForMonitor test ==="
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://aichart.lork.cloud/api/cron/event-monitor
