#!/usr/bin/env bash
set -euo pipefail
WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
CAPITAL="${1:-1000}"
cd "$WEB_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
UPDATE trading_settings
SET max_capital = ${CAPITAL},
    per_trade_pct = COALESCE(NULLIF(per_trade_pct, 0), 5)
WHERE user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
SELECT active_market, max_capital, per_trade_pct, mode FROM trading_settings LIMIT 1;
"
