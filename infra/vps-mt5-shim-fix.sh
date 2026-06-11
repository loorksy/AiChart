#!/usr/bin/env bash
set -euo pipefail
cp /opt/aichart/infra/mt5/shim.py /tmp/shim.py.bak 2>/dev/null || true
# shim.py already copied to infra/mt5/shim.py via scp
export MT5_BRIDGE_TOKEN="$(grep '^MT5_BRIDGE_TOKEN=' /opt/aichart/web/.env | cut -d= -f2-)"
cd /opt/aichart/infra
docker compose build mt5
docker compose up -d --force-recreate mt5
sleep 8
echo "=== health ==="
curl -s -H "X-Bridge-Token: $MT5_BRIDGE_TOKEN" http://127.0.0.1:18812/health || echo FAIL
echo ""
docker compose logs mt5 --tail 8
docker compose ps mt5
