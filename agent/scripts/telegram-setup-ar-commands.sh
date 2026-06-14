#!/usr/bin/env bash
# Register Arabic-described bot commands and clear English OpenClaw native menu.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMMANDS_JSON="${COMMANDS_JSON:-$REPO_ROOT/web/src/lib/telegram-ar-commands.json}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

log() { echo "[telegram-setup-ar] $*"; }

[[ -f "$COMMANDS_JSON" ]] || { log "missing $COMMANDS_JSON"; exit 1; }

TOKEN="$(node -e "const c=require(process.argv[1]); console.log(c.channels?.telegram?.botToken||'')" "$OPENCLAW_JSON")"
if [[ -z "$TOKEN" ]]; then
  WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
  if [[ -x "$SCRIPT_DIR/sync-telegram-bot.sh" ]]; then
    bash "$SCRIPT_DIR/sync-telegram-bot.sh"
    TOKEN="$(node -e "const c=require(process.argv[1]); console.log(c.channels?.telegram?.botToken||'')" "$OPENCLAW_JSON")"
  fi
fi
[[ -n "$TOKEN" ]] || { log "botToken missing — run sync-telegram-bot.sh"; exit 1; }

PAYLOAD="$(node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const cmds = (data.botCommands || []).map((c) => ({
  command: String(c.command).replace(/^\//, '').toLowerCase(),
  description: String(c.description).slice(0, 256),
}));
process.stdout.write(JSON.stringify({ commands: cmds }));
" "$COMMANDS_JSON")"

log "deleteMyCommands"
curl -fsS -X POST "https://api.telegram.org/bot${TOKEN}/deleteMyCommands" \
  -H "Content-Type: application/json" -d '{}' || true
echo ""

log "setMyCommands (Arabic descriptions)"
curl -fsS -X POST "https://api.telegram.org/bot${TOKEN}/setMyCommands" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
echo ""

log "done"
