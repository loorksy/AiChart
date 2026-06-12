#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/aichart"

log() { echo "[fix-agent] $*"; }

log "Strip CRLF from shell scripts (tar from Windows)"
find "$INSTALL_DIR/infra" "$INSTALL_DIR/agent/scripts" -name '*.sh' -type f 2>/dev/null | while read -r f; do
  sed -i 's/\r$//' "$f"
  chmod +x "$f"
done

log "Verify aichart-agent.sh"
head -3 "$INSTALL_DIR/infra/aichart-agent.sh"
bash -n "$INSTALL_DIR/infra/aichart-agent.sh" && echo "syntax OK"

log "Restart aichart-agent"
pm2 stop aichart-agent 2>/dev/null || true
sleep 2
pm2 start "$INSTALL_DIR/infra/aichart-agent.sh" --name aichart-agent --interpreter bash --update-env 2>/dev/null \
  || pm2 restart aichart-agent --update-env
pm2 save

sleep 6

log "PM2 status"
pm2 list | grep -E 'aichart|NAME' || true

log "Gateway process"
pgrep -af 'openclaw gateway' || echo "WARN: no gateway yet"

log "Recent agent out"
tail -15 /root/.pm2/logs/aichart-agent-out.log 2>/dev/null || true

log "Recent agent err"
tail -5 /root/.pm2/logs/aichart-agent-error.log 2>/dev/null || true
