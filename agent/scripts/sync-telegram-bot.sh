#!/usr/bin/env bash
# Sync TELEGRAM_BOT_TOKEN from platform_config into openclaw.json and verify getMe.
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

log() { echo "[sync-telegram-bot] $*"; }

[[ -f "$WEB_DIR/.env" ]] || { log "missing $WEB_DIR/.env"; exit 1; }
[[ -f "$OPENCLAW_JSON" ]] || { log "missing $OPENCLAW_JSON — run recovery first"; exit 1; }

log "read TELEGRAM_BOT_TOKEN from platform_config"
TOKEN="$(cd "$WEB_DIR" && node --input-type=module -e "
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';

const env = Object.fromEntries(
  fs.readFileSync('.env','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{
    const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1)];
  })
);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const { rows } = await pool.query(
  \"SELECT key, value, plain FROM platform_config WHERE key = 'TELEGRAM_BOT_TOKEN'\"
);
await pool.end();

function dec(val, encKey) {
  const [iv, tag, data] = val.split(':');
  if (!data) return val;
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'hex'), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return d.update(data, 'hex', 'utf8') + d.final('utf8');
}

const row = rows[0];
if (!row?.value) { console.error('TELEGRAM_BOT_TOKEN not in platform_config'); process.exit(1); }
const v = (row.plain ? row.value : dec(row.value, env.ENCRYPTION_KEY)).replace(/\r$/, '');
if (!v) { console.error('empty token'); process.exit(1); }
process.stdout.write(v);
")"

[[ -n "$TOKEN" ]] || { log "could not decrypt TELEGRAM_BOT_TOKEN — re-enter at /admin/keys"; exit 1; }

log "patch openclaw.json channels.telegram"
node - "$OPENCLAW_JSON" "$TOKEN" <<'NODE'
const fs = require("fs");
const [, , path, token] = process.argv;
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.channels ??= {};
cfg.channels.telegram = {
  ...(cfg.channels.telegram && typeof cfg.channels.telegram === "object"
    ? cfg.channels.telegram
    : {}),
  enabled: true,
  botToken: token,
  dmPolicy: "open",
};
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("channels.telegram.enabled=true botToken=set dmPolicy=open");
NODE

log "verify getMe"
ME="$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getMe")"
echo "$ME" | node -e "
const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
if(!j.ok) { console.error('getMe failed:', JSON.stringify(j)); process.exit(1); }
console.log('bot @' + (j.result?.username || '?'));
"

log "done"
