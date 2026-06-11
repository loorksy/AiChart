#!/usr/bin/env bash
set -euo pipefail

echo "=== /openclaw (no slash) ==="
curl -sI "https://aichart.lork.cloud/openclaw" | head -8

echo "=== /openclaw/ ==="
curl -sI "https://aichart.lork.cloud/openclaw/" | head -8

echo "=== loopback gateway ==="
curl -sI "http://127.0.0.1:18789/openclaw/" | head -8

echo "=== controlUi config ==="
node -e "const c=require('/root/.openclaw/openclaw.json'); console.log(JSON.stringify(c.gateway.controlUi,null,2))"

echo "=== web .env OPENCLAW ==="
grep OPENCLAW /opt/aichart/web/.env || true

TOKEN=$(grep '^OPENCLAW_GATEWAY_TOKEN=' /opt/aichart/web/.env | cut -d= -f2-)
echo "=== /openclaw/ with token (body head) ==="
curl -sk "https://aichart.lork.cloud/openclaw/?token=${TOKEN}" | head -20

echo "=== WebSocket upgrade (expect 101) ==="
TOKEN=$(grep '^OPENCLAW_GATEWAY_TOKEN=' /opt/aichart/web/.env | cut -d= -f2-)
curl -sk -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://aichart.lork.cloud/openclaw/?token=${TOKEN}"

echo "=== pm2 ==="
pm2 list | grep aichart || true
