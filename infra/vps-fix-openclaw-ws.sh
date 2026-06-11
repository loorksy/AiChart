#!/usr/bin/env bash
# Fix nginx: proxy /openclaw AND /openclaw/ (WebSocket uses wss://host/openclaw without trailing slash).
set -euo pipefail

TARGET="/etc/nginx/sites-enabled/aichart.lork.cloud"
MARKER="# aichart-openclaw-proxy"

python3 <<'PY'
import re
from pathlib import Path

target = Path("/etc/nginx/sites-enabled/aichart.lork.cloud")
text = target.read_text()

# Remove old openclaw location block(s)
text = re.sub(
    r"\n\s*# aichart-openclaw-proxy\n\s*location[^\n]*\{[^}]*proxy_pass[^}]*\}\n?",
    "\n",
    text,
    flags=re.S,
)

block = """
    # aichart-openclaw-proxy
    location ^~ /openclaw {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
"""

if "location ^~ /openclaw" not in text:
    text = text.replace("    listen 443 ssl", block + "\n    listen 443 ssl", 1)

target.write_text(text)
print("patched", target)
PY

# Ensure upgrade map exists in nginx.conf
NGINX_CONF="/etc/nginx/nginx.conf"
if ! grep -q 'connection_upgrade' "$NGINX_CONF" 2>/dev/null; then
  python3 <<'PY'
from pathlib import Path
p = Path("/etc/nginx/nginx.conf")
text = p.read_text()
if "connection_upgrade" not in text:
    m = """
    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }
"""
    text = text.replace("http {", "http {\n" + m, 1)
    p.write_text(text)
    print("added connection_upgrade map to nginx.conf")
PY
fi

nginx -t
systemctl reload nginx
echo "test /openclaw WS path via nginx -> gateway"
curl -sk -o /dev/null -w "HTTP %{http_code}\n" --max-time 3 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://aichart.lork.cloud/openclaw" || true
echo done
