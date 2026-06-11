#!/usr/bin/env bash
# Install nginx snippet for /openclaw/ reverse proxy (idempotent).
set -euo pipefail

SNIPPET_SRC="${1:-/opt/aichart/infra/nginx/aichart-openclaw.conf}"
MARKER="# aichart-openclaw-proxy"
NGINX_SITES="/etc/nginx/sites-enabled"

log() { echo "[nginx-openclaw] $*"; }

[[ -f "$SNIPPET_SRC" ]] || { log "missing $SNIPPET_SRC"; exit 1; }

TARGET=""
for f in "$NGINX_SITES"/*; do
  if grep -q "aichart.lork.cloud" "$f" 2>/dev/null; then
    TARGET="$f"
    break
  fi
done

if [[ -z "$TARGET" ]]; then
  log "no vhost with aichart.lork.cloud in $NGINX_SITES"
  log "manually include $SNIPPET_SRC inside your server block"
  exit 1
fi

if grep -q "location /openclaw/" "$TARGET" 2>/dev/null && grep -q "$MARKER" "$TARGET" 2>/dev/null; then
  log "already installed in $TARGET"
else
  python3 - "$TARGET" "$SNIPPET_SRC" "$MARKER" <<'PY'
import re
import sys
from pathlib import Path

target = Path(sys.argv[1])
snippet_src = Path(sys.argv[2])
marker = sys.argv[3]
text = target.read_text()

# Remove misplaced trailing block from a prior append
text = re.sub(rf"\n{re.escape(marker)}\n(?:.*\n)*?(?=\Z)", "", text)

if "location /openclaw/" not in text:
    lines = snippet_src.read_text().splitlines()
    body = "\n".join(
        line if line.startswith("#") else f"    {line}"
        for line in lines
        if "Include inside" not in line
    )
    block = f"\n    {marker}\n{body}\n"
    text = text.replace("    listen 443 ssl", block + "    listen 443 ssl", 1)

target.write_text(text)
print(f"installed openclaw location in {target}")
PY
  log "openclaw proxy ready in $TARGET"
fi

nginx -t
systemctl reload nginx
log "nginx reloaded — test: curl -I https://aichart.lork.cloud/openclaw/"
