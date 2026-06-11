#!/usr/bin/env bash
# Post-deploy checklist for EA forex bridge on Linux VPS.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"

log() { echo "[ea-verify] $*"; }
fail() { echo "[ea-verify] FAIL: $*"; exit 1; }
ok() { echo "[ea-verify] OK: $*"; }

[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE"

grep -q '^FOREX_BACKEND=ea' "$ENV_FILE" && ok "FOREX_BACKEND=ea" || fail "FOREX_BACKEND not ea"
grep -q '^MT5_BRIDGE_URL=' "$ENV_FILE" && fail "MT5_BRIDGE_URL still active" || ok "MT5 bridge disabled"

PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2- || echo 3010)"
code="$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"
[[ "$code" == "200" ]] && ok "web HTTP $code" || fail "web HTTP $code"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q 'infra-mt5'; then
  log "WARN: mt5 container still running"
else
  ok "mt5 container stopped"
fi

cd "$WEB_DIR"
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

psql "$DATABASE_URL" -t -c "
SELECT active_market, allowed_assets
FROM trading_settings ts
JOIN users u ON u.id = ts.user_id
WHERE u.role = 'admin'
ORDER BY u.id LIMIT 1;
" | grep -q forex && ok "active_market=forex" || fail "active_market not forex"

if [[ -x "$INSTALL_DIR/infra/vps-ea-api-test.sh" ]]; then
  bash "$INSTALL_DIR/infra/vps-ea-api-test.sh" | head -c 1200
  echo ""
  ok "agent forex APIs"
fi

log "EA status (requires EA heartbeat from Windows):"
curl -fsS "http://127.0.0.1:${PORT}/api/ea/status" 2>/dev/null | head -c 500 || log "GET /api/ea/status needs session or EA offline"

log ""
log "Manual (Windows VPS):"
echo "  - MT5 Liirat-Live + AiChartBridge compiled + AutoTrading ON"
echo "  - Settings -> Integrations -> EA token -> attach to chart"
echo "  - Then re-run: curl https://aichart.lork.cloud/api/ea/status (logged in)"
