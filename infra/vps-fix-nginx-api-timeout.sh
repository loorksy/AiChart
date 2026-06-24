#!/usr/bin/env bash
# Extend nginx timeouts for /api/* (MT5 connect, long cron, etc.)
set -euo pipefail

NGINX="/etc/nginx/sites-available/aichart.lork.cloud"
SNIPPET="/opt/aichart/infra/nginx/aichart-api-timeouts.conf"
MARKER="# aichart-api-timeouts"

[[ -f "$NGINX" ]] || { echo "missing $NGINX"; exit 1; }
[[ -f "$SNIPPET" ]] || { echo "missing $SNIPPET — sync repo first"; exit 1; }

if grep -q "$MARKER" "$NGINX" 2>/dev/null; then
  echo "nginx api timeouts already installed"
else
  tmp="$(mktemp)"
  awk -v marker="$MARKER" -v file="$SNIPPET" '
    $0 ~ /^[[:space:]]*location \// && !done {
      while ((getline line < file) > 0) print line
      print "    " marker
      close(file)
      done=1
    }
    { print }
  ' "$NGINX" >"$tmp"
  cp "$tmp" "$NGINX"
  rm -f "$tmp"
  echo "inserted api timeout block"
fi

nginx -t
systemctl reload nginx
echo "nginx reloaded — /api/ proxy_read_timeout=180s"
