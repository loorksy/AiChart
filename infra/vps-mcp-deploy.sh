#!/usr/bin/env bash
# Deploy / restart aichart-mcp on VPS + nginx snippet reminder.
set -euo pipefail

REPO="${1:-/opt/aichart}"
cd "$REPO/mcp"

echo "==> npm ci + build"
npm ci
npm run build

echo "==> pm2 aichart-mcp"
if pm2 describe aichart-mcp >/dev/null 2>&1; then
  pm2 restart aichart-mcp --update-env
else
  pm2 start "$REPO/infra/aichart-mcp.sh" --name aichart-mcp --interpreter bash
fi
pm2 save

echo "==> health"
sleep 2
curl -sf -H "Host: $(grep '^MCP_PUBLIC_URL=' "$REPO/web/.env" 2>/dev/null | sed 's|.*://||;s|/.*||' || echo aichart.lork.cloud)" \
  "http://127.0.0.1:${MCP_PORT:-8787}/health" | head -c 400
echo ""

echo ""
echo "Include infra/nginx/aichart-mcp.conf in your nginx vhost, then:"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "Claude connector URL: \${MCP_PUBLIC_URL:-https://aichart.lork.cloud/mcp}"
