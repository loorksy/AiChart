#!/usr/bin/env bash
# Set default forex trading settings for the first admin user.
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
ENV_FILE="$WEB_DIR/.env"
FOREX_ASSETS="${FOREX_ASSETS:-EURUSD,GBPUSD,USDJPY,XAUUSD}"

cd "$WEB_DIR"
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL missing"; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
UPDATE trading_settings
SET allowed_assets = '${FOREX_ASSETS}'
WHERE user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

SELECT u.id, u.email, ts.allowed_assets
FROM trading_settings ts
JOIN users u ON u.id = ts.user_id
WHERE u.role = 'admin'
ORDER BY u.id
LIMIT 1;
"

echo "[forex-settings] done"
