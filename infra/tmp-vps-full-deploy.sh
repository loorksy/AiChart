#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart
echo "==> Extract"
tar -xzf /tmp/full-deploy.tgz
echo "==> Web build"
cd /opt/aichart/web
npm run build
echo "==> MCP build"
cd /opt/aichart/mcp
npm run build
npm run schemas:check || echo "WARN: schemas:check failed"
echo "==> PM2 restart"
pm2 restart aichart-web --update-env
pm2 restart aichart-mcp --update-env
pm2 save
sleep 5
echo "==> PM2 status"
pm2 list | grep aichart || true
echo "==> Health"
curl -sf -o /dev/null -w "HTTPS %{http_code}\n" https://aichart.lork.cloud/
curl -sf http://127.0.0.1:8787/health
echo ""
curl -sf -o /dev/null -w "web local %{http_code}\n" http://127.0.0.1:3010/
echo "==> EA"
ls -la /opt/aichart/ea/mt5/AiChartBridge.ex5
grep '#property version' /opt/aichart/ea/mt5/AiChartBridge.mq5
test -f web/src/lib/markets/forexSnapshot.ts && echo forexSnapshot OK
test -f web/src/lib/eaQuoteMetrics.ts && echo eaQuoteMetrics OK
grep -q DRAW_CAPTURE_MAX_MS mcp/src/tools/chartInline.ts && echo mcp_30s_poll OK
echo "==> PM2 logs (errors only, last 20)"
pm2 logs aichart-web --nostream --lines 20 2>/dev/null | grep -iE 'error|Error|ERR' | tail -5 || echo "no web errors in tail"
pm2 logs aichart-mcp --nostream --lines 20 2>/dev/null | grep -iE 'error|Error|ERR' | tail -5 || echo "no mcp errors in tail"
echo "==> Deploy script done"
