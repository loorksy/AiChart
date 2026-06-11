#!/usr/bin/env bash
set -euo pipefail
TARGET="/etc/nginx/sites-enabled/aichart.lork.cloud"

python3 <<'PY'
import re
from pathlib import Path

path = Path("/etc/nginx/sites-enabled/aichart.lork.cloud")
text = path.read_text()

# Drop trailing block appended outside server { }
text = re.sub(r"\n# aichart-openclaw-proxy\n(?:.*\n)*?(?=\Z)", "", text)

snippet = """
    # aichart-openclaw-proxy
    location /openclaw/ {
        proxy_pass http://127.0.0.1:18789/openclaw/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
"""

if "location /openclaw/" not in text:
    text = text.replace("    listen 443 ssl", snippet + "\n    listen 443 ssl", 1)

path.write_text(text)
print("nginx vhost updated")
PY

nginx -t
systemctl reload nginx
echo "=== curl /openclaw/ ==="
curl -sI "https://aichart.lork.cloud/openclaw/" | head -8
