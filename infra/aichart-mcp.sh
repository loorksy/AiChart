#!/usr/bin/env bash
# Start AiChart MCP Server (Claude Connectors bridge).
set -euo pipefail

REPO="${AICHART_INSTALL_DIR:-/opt/aichart}"
MCP_DIR="$REPO/mcp"
WEB_ENV="$REPO/web/.env"

cd "$MCP_DIR"

if [[ -f "$WEB_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(AICHART_API_URL|AICHART_SERVICE_TOKEN|MCP_|PORT=|DB_PATH=|DATABASE_URL=|BRIDGE_FETCH_TIMEOUT_MS=)' "$WEB_ENV" 2>/dev/null | sed 's/\r$//')
  set +a
  PORT="${PORT:-3010}"
  export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:${PORT}}"
  DB_PATH="${DB_PATH:-data/aichart.db}"
  if [[ "$DB_PATH" != /* ]]; then
    export DB_PATH="$REPO/web/$DB_PATH"
  else
    export DB_PATH="$DB_PATH"
  fi
fi

export MCP_PORT="${MCP_PORT:-8787}"
export MCP_AUTH_MODE="${MCP_AUTH_MODE:-oauth}"
export MCP_ACCESS_TOKEN_TTL_DAYS="${MCP_ACCESS_TOKEN_TTL_DAYS:-365}"
export MCP_REFRESH_TOKEN_TTL_DAYS="${MCP_REFRESH_TOKEN_TTL_DAYS:-365}"
export NODE_ENV=production

if [[ ! -f dist/index.js ]]; then
  npm ci
  npm run build
fi

exec node dist/index.js
