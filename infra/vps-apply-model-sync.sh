#!/usr/bin/env bash
# Apply model-sync feature on VPS (safe: sync-model only, preserves exec no-approval).
set -euo pipefail

AICHART="${AICHART:-/opt/aichart}"
WEB_ENV="$AICHART/web/.env"

upsert_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$WEB_ENV" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$WEB_ENV"
  else
    echo "${k}=${v}" >>"$WEB_ENV"
  fi
}

upsert_env "OPENCLAW_CONFIG" "/root/.openclaw/openclaw.json"
upsert_env "OPENCLAW_AUTO_RESTART" "1"
echo "OPENCLAW_* in web/.env"

cd "$AICHART/web"
npm run build

set -a
source "$WEB_ENV"
source /root/.openclaw/.env 2>/dev/null || true
set +a
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:${PORT:-3010}}"

bash "$AICHART/agent/scripts/sync-model.sh"
pm2 restart aichart-agent --update-env
pm2 restart aichart-web --update-env

echo "=== agent model status ==="
node -e "
const fs=require('fs');
const p='/root/.openclaw/openclaw.json';
const c=JSON.parse(fs.readFileSync(p,'utf8'));
const m=c.agents?.defaults?.model;
const primary=typeof m==='object'?m.primary:m;
console.log('primary:', primary);
console.log('thinkingDefault:', c.agents?.defaults?.thinkingDefault);
console.log('model thinking:', c.agents?.defaults?.models?.[primary]?.params?.thinking);
"

pm2 logs aichart-agent --lines 8 --nostream 2>&1 | grep -E 'agent model|thinking' || true
echo done
