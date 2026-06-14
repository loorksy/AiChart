#!/usr/bin/env bash
# Telegram bot + OpenClaw gateway health check with fix hints.
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"
ISSUES=0

warn() { echo "WARN: $*"; ISSUES=$((ISSUES + 1)); }
ok() { echo "OK: $*"; }
fail() { echo "FAIL: $*"; ISSUES=$((ISSUES + 1)); }

echo "=== PM2 ==="
if pm2 list 2>/dev/null | grep -q "aichart-agent.*online"; then
  ok "aichart-agent online"
else
  fail "aichart-agent not online — pm2 restart aichart-agent"
fi
if pm2 list 2>/dev/null | grep -q "aichart-web.*online"; then
  ok "aichart-web online"
else
  fail "aichart-web not online — pm2 restart aichart-web"
fi

echo ""
echo "=== openclaw telegram config ==="
if [[ ! -f "$OPENCLAW_JSON" ]]; then
  fail "missing $OPENCLAW_JSON"
else
  node - "$OPENCLAW_JSON" <<'NODE'
const c = require(process.argv[2]);
const tg = c.channels?.telegram ?? {};
console.log("enabled:", tg.enabled ?? false);
console.log("botToken:", tg.botToken ? "set (" + tg.botToken.length + " chars)" : "MISSING");
console.log("dmPolicy:", tg.dmPolicy ?? "(default)");
console.log("commands.native:", tg.commands?.native ?? "(auto)");
NODE
  TOKEN="$(node -e "const c=require(process.argv[1]); console.log(c.channels?.telegram?.botToken||'')" "$OPENCLAW_JSON")"
  if [[ -z "$TOKEN" ]]; then
    fail "botToken missing in openclaw.json — bash agent/scripts/sync-telegram-bot.sh"
  else
    ME="$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe")"
    if echo "$ME" | grep -q '"ok":true'; then
      ok "getMe: $(echo "$ME" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).result.username")"
    else
      fail "getMe failed — re-enter TELEGRAM_BOT_TOKEN at /admin/keys"
    fi
    WH="$(curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo")"
    URL="$(echo "$WH" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).result.url||''" 2>/dev/null || echo "")"
    if [[ -n "$URL" ]]; then
      fail "webhook active: $URL — bash infra/vps-openclaw-telegram-reconnect.sh"
    else
      ok "webhook empty (polling OK)"
    fi
  fi
fi

echo ""
echo "=== Bridge API ==="
if [[ -f "$WEB_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$WEB_DIR/.env"
  set +a
  PORT="${PORT:-3010}"
  SVC="${AICHART_SERVICE_TOKEN:-}"
  if [[ -n "$SVC" ]]; then
    CODE="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SVC" "http://127.0.0.1:${PORT}/api/agent/risk/status" || echo 000)"
    if [[ "$CODE" == "200" ]]; then
      ok "Bridge risk/status HTTP 200"
    else
      fail "Bridge HTTP $CODE — check AICHART_SERVICE_TOKEN and aichart-web"
    fi
  else
    warn "AICHART_SERVICE_TOKEN missing in .env"
  fi
else
  warn "missing $WEB_DIR/.env"
fi

echo ""
echo "=== admin telegram link ==="
if [[ -n "${DATABASE_URL:-}" ]]; then
  psql "$DATABASE_URL" -t -A -c "
    SELECT u.id || '|' || COALESCE(u.telegram_id::text,'') || '|' || COALESCE(ts.telegram_chat_id,'')
    FROM users u
    LEFT JOIN trading_settings ts ON ts.user_id = u.id
    WHERE u.role = 'admin'
    ORDER BY u.id ASC LIMIT 1;
  " 2>/dev/null | while IFS='|' read -r uid tid chat; do
    if [[ -z "$tid" ]]; then
      warn "admin user $uid has no telegram_id — bash infra/vps-link-telegram-admin.sh <ID>"
    else
      ok "admin telegram_id=$tid chat_id=${chat:-—}"
    fi
  done || warn "could not query admin telegram link"
fi

echo ""
echo "=== agent error log (last 20) ==="
tail -20 /root/.pm2/logs/aichart-agent-error.log 2>/dev/null || echo "(no log)"

echo ""
if [[ "$ISSUES" -gt 0 ]]; then
  echo "=== $ISSUES issue(s) — suggested fix ==="
  echo "  bash agent/scripts/sync-telegram-bot.sh"
  echo "  bash agent/scripts/telegram-setup-ar-commands.sh"
  echo "  bash infra/vps-openclaw-telegram-reconnect.sh"
  echo "  pm2 restart aichart-agent aichart-web"
  exit 1
fi
echo "=== all checks passed ==="
