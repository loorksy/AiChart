#!/usr/bin/env bash
# Collect Telegram bot runtime evidence as NDJSON (debug session cdb263).
set -euo pipefail

LOG="${DEBUG_LOG_PATH:-/opt/aichart/debug-cdb263.log}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"
WEB_ENV="$INSTALL_DIR/web/.env"

log_line() {
  local hyp="$1" loc="$2" msg="$3" data="${4:-{}}"
  printf '%s\n' "{\"sessionId\":\"cdb263\",\"timestamp\":$(date +%s000),\"hypothesisId\":\"$hyp\",\"location\":\"$loc\",\"message\":\"$msg\",\"data\":$data}" >>"$LOG"
}

mkdir -p "$(dirname "$LOG")"
: >"$LOG"

# H-A: LLM auth + transport
ANTH_API="$(openclaw config get models.providers.anthropic.api 2>/dev/null || echo missing)"
AUTH_STATUS="$(openclaw models status 2>&1 | head -20 | tr '\n' ' ' | sed 's/"/\\"/g')"
PRIMARY="$(openclaw config get agents.defaults.model.primary 2>/dev/null || echo missing)"
log_line "A" "vps-probe:auth" "openclaw anthropic config" "{\"anthropicApi\":\"$ANTH_API\",\"primaryModel\":\"$PRIMARY\",\"authStatus\":\"$AUTH_STATUS\"}"

# H-B: Telegram polling + recent ingress
TG_ENABLED="$(node -e "const c=require(process.argv[1]); console.log(c.channels?.telegram?.enabled)" "$OPENCLAW_JSON" 2>/dev/null || echo unknown)"
WEBHOOK_URL="$(curl -fsS "https://api.telegram.org/bot$(node -p "require('$OPENCLAW_JSON').channels.telegram.botToken")/getWebhookInfo" 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.result?.url||'')}catch{console.log('err')}})" 2>/dev/null || echo err)"
RECENT_TG="$(grep -E 'telegram|embedded run|401|ProviderAuth|inbound|ingress' /tmp/openclaw/openclaw-$(date -u +%Y-%m-%d).log 2>/dev/null | tail -8 | tr '\n' ' ' | sed 's/"/\\"/g' || true)"
log_line "B" "vps-probe:telegram" "telegram channel state" "{\"enabled\":\"$TG_ENABLED\",\"webhookUrl\":\"$WEBHOOK_URL\",\"recentLog\":\"$RECENT_TG\"}"

# H-C: Token decrypt (platform DB)
DECRYPT_OK="false"
DECRYPT_ERR=""
if [[ -f "$WEB_ENV" ]]; then
  if (cd "$INSTALL_DIR/web" && node --input-type=module -e "
import pg from 'pg'; import fs from 'fs'; import crypto from 'crypto';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const {rows}=await pool.query(\"SELECT value,plain FROM platform_config WHERE key='TELEGRAM_BOT_TOKEN'\");
await pool.end();
const row=rows[0]; if(!row?.value) process.exit(2);
if(row.plain){ console.log('ok-plain'); process.exit(0); }
const [iv,tag,data]=row.value.split(':');
const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),Buffer.from(iv,'hex'));
d.setAuthTag(Buffer.from(tag,'hex')); d.update(data,'hex','utf8')+d.final('utf8');
console.log('ok-decrypt');
" 2>/dev/null); then
    DECRYPT_OK="true"
  else
    DECRYPT_ERR="decrypt_failed"
  fi
fi
log_line "C" "vps-probe:decrypt" "TELEGRAM_BOT_TOKEN decrypt test" "{\"ok\":$DECRYPT_OK,\"error\":\"$DECRYPT_ERR\"}"

# H-D: PM2 agent errors
PM2_ERR="$(tail -5 /root/.pm2/logs/aichart-agent-error.log 2>/dev/null | tr '\n' ' ' | sed 's/"/\\"/g')"
log_line "D" "vps-probe:pm2" "recent agent errors" "{\"tail\":\"$PM2_ERR\"}"

# H-E: Bridge + admin link
BRIDGE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $(grep '^AICHART_SERVICE_TOKEN=' "$WEB_ENV" | cut -d= -f2- | tr -d '\r')" http://127.0.0.1:3010/api/agent/risk/status 2>/dev/null || echo 0)"
ADMIN_TG="$(cd "$INSTALL_DIR/web" && node --input-type=module -e "
import pg from 'pg'; import fs from 'fs';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
const pool=new pg.Pool({connectionString:env.DATABASE_URL});
const {rows}=await pool.query(\"SELECT telegram_id,telegram_chat_id FROM users WHERE role='admin' LIMIT 1\");
await pool.end();
const u=rows[0]; console.log(JSON.stringify({telegram_id:u?.telegram_id||null,chat_id:u?.telegram_chat_id||null}));
" 2>/dev/null || echo '{}')"
log_line "E" "vps-probe:bridge" "bridge and admin link" "{\"bridgeHttp\":$BRIDGE_CODE,\"admin\":$ADMIN_TG}"

echo "probe written to $LOG"
cat "$LOG"
