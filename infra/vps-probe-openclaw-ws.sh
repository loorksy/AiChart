#!/usr/bin/env bash
set -euo pipefail
T=$(grep '^OPENCLAW_GATEWAY_TOKEN=' /opt/aichart/web/.env | cut -d= -f2-)

echo "=== control-ui-config ==="
for path in /openclaw/control-ui-config.json /control-ui-config.json; do
  code=$(curl -sk -o /tmp/ocfg.json -w "%{http_code}" "http://127.0.0.1:18789${path}?token=${T}")
  echo "$path -> HTTP $code"
  [[ "$code" == "200" ]] && head -c 500 /tmp/ocfg.json && echo
done

echo "=== WS upgrade paths ==="
for path in /openclaw /openclaw/ /; do
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 3 \
    -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "http://127.0.0.1:18789${path}")
  echo "loopback WS $path -> $code"
done

echo "=== via nginx WS /openclaw ==="
code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 3 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://aichart.lork.cloud/openclaw")
echo "nginx WS /openclaw -> $code"

code2=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 3 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://aichart.lork.cloud/openclaw/")
echo "nginx WS /openclaw/ -> $code2"
