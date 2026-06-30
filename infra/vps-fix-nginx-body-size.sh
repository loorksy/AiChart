#!/usr/bin/env bash
# Raise nginx body limit for chart analyze (base64 screenshot in POST body).
set -euo pipefail

NGINX="/etc/nginx/sites-available/aichart.lork.cloud"
SNIPPET="/opt/aichart/infra/nginx/aichart-api-timeouts.conf"
MARKER="client_max_body_size"

[[ -f "$NGINX" ]] || { echo "missing $NGINX"; exit 1; }

if grep -q "$MARKER" "$NGINX" 2>/dev/null; then
  echo "client_max_body_size already set in nginx site"
else
  if [[ -f "$SNIPPET" ]] && grep -q "$MARKER" "$SNIPPET" 2>/dev/null; then
    bash /opt/aichart/infra/vps-fix-nginx-api-timeout.sh || true
  fi
  if ! grep -q "$MARKER" "$NGINX" 2>/dev/null; then
    tmp="$(mktemp)"
    awk '
      /^[[:space:]]*server[[:space:]]*\{/ && !done {
        print
        print "    client_max_body_size 12m;"
        done=1
        next
      }
      { print }
    ' "$NGINX" >"$tmp"
    cp "$tmp" "$NGINX"
    rm -f "$tmp"
    echo "inserted client_max_body_size 12m in server block"
  fi
fi

nginx -t
systemctl reload nginx
echo "nginx reloaded — client_max_body_size=12m"
