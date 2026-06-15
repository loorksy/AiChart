#!/usr/bin/env bash
# Sync LLM API keys from platform_config into OpenClaw agent auth store.
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
PROVIDER="${1:-anthropic}"

log() { echo "[sync-openclaw-auth] $*"; }

[[ -f "$WEB_DIR/.env" ]] || { log "missing $WEB_DIR/.env"; exit 1; }

KEY_FIELD=""
case "$PROVIDER" in
  anthropic) KEY_FIELD="ANTHROPIC_API_KEY" ;;
  openai) KEY_FIELD="OPENAI_API_KEY" ;;
  google|gemini) KEY_FIELD="GEMINI_API_KEY"; PROVIDER="google" ;;
  *) log "unsupported provider: $PROVIDER"; exit 1 ;;
esac

log "read $KEY_FIELD from platform_config"
API_KEY="$(cd "$WEB_DIR" && node --input-type=module -e "
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
  'SELECT key, value, plain FROM platform_config WHERE key = \$1',
  [process.argv[1]]
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
if (!row?.value) { console.error(process.argv[1] + ' not in platform_config'); process.exit(1); }
const v = (row.plain ? row.value : dec(row.value, env.ENCRYPTION_KEY)).replace(/\r$/, '');
if (!v) { console.error('empty key'); process.exit(1); }
process.stdout.write(v);
" "$KEY_FIELD")"

[[ -n "$API_KEY" ]] || { log "could not read $KEY_FIELD — re-enter at /admin/keys"; exit 1; }

log "paste-api-key provider=$PROVIDER"
printf '%s' "$API_KEY" | openclaw models auth paste-api-key --provider "$PROVIDER"

if [[ "$PROVIDER" == "anthropic" ]]; then
  log "ensure anthropic-messages transport"
  openclaw config set models.providers.anthropic.api anthropic-messages 2>/dev/null || true
  openclaw config unset models.providers.anthropic.apiKey 2>/dev/null || true
fi

log "models status:"
openclaw models status 2>&1 | head -15

log "done"
