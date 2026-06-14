#!/usr/bin/env bash
set -euo pipefail

echo "=== nginx aichart ==="
ls -la /etc/nginx/sites-available/aichart* 2>/dev/null || echo "no aichart nginx file"
wc -c /etc/nginx/sites-available/aichart.lork.cloud 2>/dev/null || true

echo "=== db users count ==="
sudo -u postgres psql aichart -t -c "SELECT COUNT(*) FROM users;"

echo "=== platform keys ==="
sudo -u postgres psql aichart -t -c "SELECT key FROM platform_config ORDER BY key;"

echo "=== postgres roles ==="
sudo -u postgres psql -t -c "SELECT rolname FROM pg_roles WHERE rolname LIKE '%aichart%';"

echo "=== pm2 dump aichart snippets ==="
grep -oE 'DATABASE_URL[^,}]+|CRON_SECRET[^,}]+|AICHART_SERVICE_TOKEN[^,}]+|PORT[^,}]+|ENCRYPTION_KEY[^,}]+' /root/.pm2/dump.pm2 2>/dev/null | head -20 || true

echo "=== openclaw installed ==="
which openclaw || npm list -g openclaw 2>/dev/null || echo "openclaw missing"

echo "=== cert ==="
ls /etc/letsencrypt/live/aichart.lork.cloud/ 2>/dev/null || echo "no cert dir"
