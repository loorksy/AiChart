#!/usr/bin/env bash
# Start the AiChart scalp worker (continuous buy/close/sell loop).
# Paper mode by default; set SCALP_LIVE_ENABLED=1 in web/.env to execute live.
set -euo pipefail

REPO="${AICHART_INSTALL_DIR:-/opt/aichart}"
WEB_DIR="$REPO/web"
WEB_ENV="$WEB_DIR/.env"

cd "$WEB_DIR"

if [[ -f "$WEB_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(DATABASE_URL=|DB_PATH=|REDIS_URL=|SCALP_LIVE_ENABLED=|SCALP_TICK_MS=|MT5_BRIDGE_URL=|MT5_BRIDGE_TOKEN=|FOREX_BACKEND=|METAAPI_TOKEN=|METAAPI_REGION=)' "$WEB_ENV" 2>/dev/null | sed 's/\r$//')
  set +a
fi

export NODE_ENV=production

exec npx tsx src/lib/scalp/run.ts
