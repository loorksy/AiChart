#!/usr/bin/env bash
set -euo pipefail
echo "=== hunt old ENCRYPTION_KEY ==="
grep -rhoE '[a-f0-9]{64}' /root/.pm2/dump.pm2 /root/.pm2/logs/aichart-web-out.log /root/.pm2/logs/aichart-web-error.log /root/.bash_history 2>/dev/null | sort -u | head -20
echo "=== backups ==="
find /root /opt /tmp -maxdepth 4 -name '.env*' -o -name 'aichart.env' 2>/dev/null | head -20
find /root/.openclaw -name '*.bak' -o -name 'openclaw.json.bak' 2>/dev/null | head -10
echo "=== test decrypt with current key ==="
cd /opt/aichart/web
node --input-type=module -e "
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split(/\n/).filter(l=>l&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const { rows } = await pool.query(\"SELECT key, value FROM platform_config WHERE key='ANTHROPIC_API_KEY'\");
await pool.end();
function dec(val, encKey) {
  const [iv, tag, data] = val.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey,'hex'), Buffer.from(iv,'hex'));
  d.setAuthTag(Buffer.from(tag,'hex'));
  return d.update(data,'hex','utf8')+d.final('utf8');
}
try {
  const v = dec(rows[0].value, env.ENCRYPTION_KEY);
  console.log('decrypt OK, key prefix:', v.slice(0,8)+'...');
} catch(e) { console.log('decrypt FAIL:', e.message); }
"
