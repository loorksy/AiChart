#!/usr/bin/env bash
# Reconnect Telegram to OpenClaw after webhook/channel disruption.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"
WEB_ENV="/opt/aichart/web/.env"
SCRIPT_DIR="$INSTALL_DIR/agent/scripts"

log() { echo "[telegram-reconnect] $*"; }

[[ -f "$OPENCLAW_JSON" ]] || { log "missing $OPENCLAW_JSON"; exit 1; }

if [[ -x "$SCRIPT_DIR/sync-telegram-bot.sh" ]]; then
  log "sync bot token from platform_config"
  bash "$SCRIPT_DIR/sync-telegram-bot.sh" || log "sync-telegram-bot failed (continuing)"
fi

TOKEN="$(node -e "const c=require(process.argv[1]); console.log(c.channels?.telegram?.botToken||'')" "$OPENCLAW_JSON")"
[[ -n "$TOKEN" ]] || { log "telegram botToken missing in openclaw.json"; exit 1; }

log "ensure telegram channel enabled in openclaw.json"
node - "$OPENCLAW_JSON" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.channels = cfg.channels || {};
cfg.channels.telegram = cfg.channels.telegram || {};
cfg.channels.telegram.enabled = true;
if (!cfg.channels.telegram.botToken) {
  console.error("botToken missing");
  process.exit(1);
}
if (!cfg.channels.telegram.dmPolicy) {
  cfg.channels.telegram.dmPolicy = "open";
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("telegram.enabled=true");
NODE

log "clear Telegram API webhook (OpenClaw uses polling)"
curl -fsS "https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=false" || true
echo ""

log "webhook info:"
curl -fsS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
echo ""

if [[ -x "$SCRIPT_DIR/telegram-setup-ar-commands.sh" ]]; then
  log "register Arabic bot commands"
  bash "$SCRIPT_DIR/telegram-setup-ar-commands.sh" || log "setup-ar-commands failed (continuing)"
fi

if [[ -x "$SCRIPT_DIR/sync-openclaw-auth.sh" ]]; then
  log "sync LLM API keys from platform_config to OpenClaw auth"
  bash "$SCRIPT_DIR/sync-openclaw-auth.sh" anthropic || log "sync-openclaw-auth failed (continuing)"
fi

if [[ -f "$WEB_ENV" ]]; then
  PORT="$(grep '^PORT=' "$WEB_ENV" | cut -d= -f2- || echo 3010)"
  SVC="$(grep '^AICHART_SERVICE_TOKEN=' "$WEB_ENV" | cut -d= -f2- || true)"
  mkdir -p /root/.openclaw
  ENV_FILE="/root/.openclaw/.env"
  touch "$ENV_FILE"
  upsert() {
    local k="$1" v="$2"
    if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
    else
      echo "${k}=${v}" >>"$ENV_FILE"
    fi
  }
  upsert "AICHART_API_URL" "http://127.0.0.1:${PORT}"
  if [[ -n "$SVC" ]]; then
    SVC="$(printf '%s' "$SVC" | tr -d '\r')"
    upsert "AICHART_SERVICE_TOKEN" "$SVC"
  fi
  log "updated /root/.openclaw/.env (AICHART_API_URL=http://127.0.0.1:${PORT})"
fi

log "restart OpenClaw gateway"
pm2 stop aichart-agent || true
sleep 3
pm2 start aichart-agent --update-env
sleep 5
pm2 list | grep aichart-agent || true

log "done — send a test message to the bot in Telegram"
