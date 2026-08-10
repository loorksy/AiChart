#!/usr/bin/env bash
# Start AiChart MCP Server (Claude Connectors bridge).
set -euo pipefail

REPO="${AICHART_INSTALL_DIR:-/opt/aichart}"
MCP_DIR="$REPO/mcp"
# App root owns .env after the web/ → root merge; keep a one-release fallback
# for boxes that still only have the leftover web/.env copy.
APP_ENV="$REPO/.env"
if [[ ! -f "$APP_ENV" && -f "$REPO/web/.env" ]]; then
  APP_ENV="$REPO/web/.env"
fi

cd "$MCP_DIR"

if [[ -f "$APP_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(AICHART_API_URL|AICHART_SERVICE_TOKEN|GIT_COMMIT=|MCP_|PORT=|DB_PATH=|DATABASE_URL=|BRIDGE_FETCH_TIMEOUT_MS=)' "$APP_ENV" 2>/dev/null | sed 's/\r$//')
  set +a
  PORT="${PORT:-3010}"
  export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:${PORT}}"
  DB_PATH="${DB_PATH:-data/aichart.db}"
  if [[ "$DB_PATH" != /* ]]; then
    if [[ -e "$REPO/$DB_PATH" || ! -e "$REPO/web/$DB_PATH" ]]; then
      export DB_PATH="$REPO/$DB_PATH"
    else
      export DB_PATH="$REPO/web/$DB_PATH"
    fi
  else
    export DB_PATH="$DB_PATH"
  fi
fi

export MCP_PORT="${MCP_PORT:-8787}"
export MCP_AUTH_MODE="${MCP_AUTH_MODE:-oauth}"
export MCP_ACCESS_TOKEN_TTL_DAYS="${MCP_ACCESS_TOKEN_TTL_DAYS:-365}"
export MCP_REFRESH_TOKEN_TTL_DAYS="${MCP_REFRESH_TOKEN_TTL_DAYS:-365}"
export NODE_ENV=production

# Rebuild when the build is missing OR older than any input that produced it.
#
# This used to be `[[ ! -f dist/index.js ]]` alone, which builds exactly once
# and never again: dist/index.js exists forever after, so every later
# `pm2 restart aichart-mcp` re-launched the same stale bundle. Production ran a
# three-day-old build of this server without a single visible symptom — the web
# app deployed and restarted normally beside it, so nothing looked wrong. It
# was serving MCP tools whose backing routes had already been deleted: the tool
# was still offered to the model, and calling it returned 404.
#
# `find -newer` on the sources plus the manifests is cheap (milliseconds) and
# leaves a normal restart untouched when nothing changed.
needs_build=0
if [[ ! -f dist/index.js ]]; then
  needs_build=1
elif [[ -n "$(find src package.json package-lock.json tsconfig.json -newer dist/index.js -print -quit 2>/dev/null)" ]]; then
  echo "[aichart-mcp] sources are newer than dist — rebuilding" >&2
  needs_build=1
fi

if (( needs_build )); then
  # node_modules can outlive dist; only reinstall when it is actually absent or
  # the lockfile moved, so a routine source change does not pay for npm ci.
  if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules ]]; then
    npm ci
  fi
  npm run build
fi

exec node dist/index.js
