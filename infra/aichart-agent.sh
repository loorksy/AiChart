#!/usr/bin/env bash
set -euo pipefail

WEB_DIR="/opt/aichart/web"
ENV_FILE="$WEB_DIR/.env"
PORT=3010

cd "$WEB_DIR"

eval "$(node --input-type=module -e "
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
  \"SELECT key, value, plain FROM platform_config WHERE key IN ('ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','TELEGRAM_BOT_TOKEN')\"
);
await pool.end();

function dec(val, encKey) {
  const [iv, tag, data] = val.split(':');
  if (!data) return val;
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'hex'), Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return d.update(data, 'hex', 'utf8') + d.final('utf8');
}

for (const r of rows) {
  const v = r.plain ? r.value : dec(r.value, env.ENCRYPTION_KEY);
  if (v) {
    console.log('export ' + r.key + '=' + JSON.stringify(v));
    if (r.key === 'GEMINI_API_KEY') {
      console.log('export GOOGLE_API_KEY=' + JSON.stringify(v));
    }
  }
}
const svc = env.AICHART_SERVICE_TOKEN;
if (svc) console.log('export AICHART_SERVICE_TOKEN=' + JSON.stringify(svc));
console.log('export AICHART_API_URL=' + JSON.stringify('http://127.0.0.1:' + (env.PORT || '$PORT')));
")"

export OPENCLAW_NO_RESPAWN=1
export NODE_ENV=production

exec openclaw gateway run
