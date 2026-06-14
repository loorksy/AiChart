#!/usr/bin/env bash
set -euo pipefail
echo "=== platform_config ==="
sudo -u postgres psql aichart -c "SELECT key, plain, left(value,50) AS val FROM platform_config ORDER BY key;"
echo "=== openclaw gateway.mode ==="
node -pe "require('/root/.openclaw/openclaw.json').gateway?.mode || 'MISSING'"
echo "=== unique ENCRYPTION_KEY in pm2 dump ==="
strings /root/.pm2/dump.pm2 | grep -oE 'ENCRYPTION_KEY[^,}]+' | sort -u | head -10
