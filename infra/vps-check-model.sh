#!/usr/bin/env bash
source /opt/aichart/web/.env
echo "=== platform ANTHROPIC_MODEL ==="
psql "$DATABASE_URL" -t -c "SELECT key, value, updated_at FROM platform_config WHERE key='ANTHROPIC_MODEL';"
echo "=== users ==="
psql "$DATABASE_URL" -t -c "SELECT id, role, status FROM users;"
echo "=== openclaw primary ==="
node -pe "require('/root/.openclaw/openclaw.json').agents?.defaults?.model?.primary"
ls -la /root/.openclaw/agents/main/sessions-archive-* 2>/dev/null | tail -3
