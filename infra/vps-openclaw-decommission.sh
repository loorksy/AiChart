#!/usr/bin/env bash
# Remove OpenClaw from VPS — frees ~/.openclaw disk (sessions/jsonl).
# Safe for MCP-first deployments (aichart-web + aichart-mcp keep running).
set -euo pipefail

log() { echo "[openclaw-decommission] $*"
}

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/web/.env}"
NGINX_VHOST="${NGINX_VHOST:-/etc/nginx/sites-enabled/aichart.lork.cloud}"

log "=== before ==="
du -sh /root/.openclaw /tmp/openclaw 2>/dev/null || true
pm2 list 2>/dev/null | grep -E 'aichart-agent|openclaw' || true

log "stop pm2 aichart-agent"
pm2 stop aichart-agent 2>/dev/null || true
pm2 delete aichart-agent 2>/dev/null || true

log "remove OpenClaw data"
rm -rf /root/.openclaw
rm -rf /tmp/openclaw

log "remove global openclaw package"
npm uninstall -g openclaw 2>/dev/null || true
npm cache clean --force 2>/dev/null || true

log "remove pm2 agent logs"
rm -f /root/.pm2/logs/aichart-agent-out.log
rm -f /root/.pm2/logs/aichart-agent-error.log

if [[ -f "$ENV_FILE" ]]; then
  log "set OPENCLAW_ENABLED=0 in $ENV_FILE"
  if grep -q '^OPENCLAW_ENABLED=' "$ENV_FILE" 2>/dev/null; then
    sed -i 's/^OPENCLAW_ENABLED=.*/OPENCLAW_ENABLED=0/' "$ENV_FILE"
  else
    echo "OPENCLAW_ENABLED=0" >> "$ENV_FILE"
  fi
  if grep -q '^OPENCLAW_AUTO_RESTART=' "$ENV_FILE" 2>/dev/null; then
    sed -i 's/^OPENCLAW_AUTO_RESTART=.*/OPENCLAW_AUTO_RESTART=0/' "$ENV_FILE"
  else
    echo "OPENCLAW_AUTO_RESTART=0" >> "$ENV_FILE"
  fi
fi

if [[ -f "$NGINX_VHOST" ]] && grep -q 'aichart-openclaw.conf\|location \^~ /openclaw' "$NGINX_VHOST" 2>/dev/null; then
  log "comment out nginx /openclaw block in $NGINX_VHOST (manual review recommended)"
  sed -i '/aichart-openclaw.conf/s/^/# DISABLED openclaw: /' "$NGINX_VHOST" 2>/dev/null || true
  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || true
    log "nginx reloaded"
  else
    log "WARN: nginx -t failed — fix vhost manually"
  fi
fi

if [[ -d "$INSTALL_DIR/infra" ]] && [[ -f "$INSTALL_DIR/infra/docker-compose.yml" ]]; then
  log "stop docker openclaw service if present"
  (cd "$INSTALL_DIR/infra" && docker compose stop openclaw 2>/dev/null) || true
  (cd "$INSTALL_DIR/infra" && docker compose rm -f openclaw 2>/dev/null) || true
  docker volume rm infra_openclaw-state 2>/dev/null || \
    docker volume rm openclaw-state 2>/dev/null || true
fi

pm2 save 2>/dev/null || true

log "=== after ==="
test ! -d /root/.openclaw && log "OK: /root/.openclaw removed" || log "WARN: /root/.openclaw still exists"
pm2 list 2>/dev/null | grep aichart || true
df -h / | tail -1

log "Done. Restart web to pick up OPENCLAW_ENABLED:"
log "  pm2 restart aichart-web --update-env"
log "Deploy MCP if not yet: bash $INSTALL_DIR/infra/vps-mcp-deploy.sh"
