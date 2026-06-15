#!/usr/bin/env bash
set -euo pipefail
echo "=== TIME ==="
date -u
echo "=== SPOOL ==="
ls -la /root/.openclaw/telegram/ 2>/dev/null || echo "no telegram dir"
ls -la /root/.openclaw/telegram/ingress-spool-default/ 2>/dev/null | head -15 || echo "no spool"
echo "=== CONFIG ==="
node -p "JSON.stringify(require('/root/.openclaw/openclaw.json').channels?.telegram,null,2)"
echo "=== MODEL ==="
node -p "JSON.stringify(require('/root/.openclaw/openclaw.json').agents?.defaults?.model,null,2)"
echo "=== AGENT LOG SINCE 2242 ==="
grep '2026-06-14T22:4[2-9]\|2026-06-14T22:5' /root/.pm2/logs/aichart-agent-out.log | tail -25
echo "=== OPENCLAW TG SINCE 2242 ==="
grep '2026-06-14T22:4[2-9]\|2026-06-14T22:5' /tmp/openclaw/openclaw-2026-06-14.log | grep -i telegram | tail -15
echo "=== PROCESSES ==="
pgrep -af openclaw || true
