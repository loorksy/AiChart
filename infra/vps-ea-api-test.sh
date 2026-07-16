#!/usr/bin/env bash
set -euo pipefail
WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
cd "$WEB_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a
PORT="${PORT:-3010}"
TOKEN="${AGENT_SECRET:-${AICHART_SERVICE_TOKEN:-}}"
[[ -n "$TOKEN" ]] || { echo "missing AGENT_SECRET or AICHART_SERVICE_TOKEN"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"
echo "=== trade/readiness (technical execution state) ==="
curl -fsS -H "$AUTH" \
  "http://127.0.0.1:${PORT}/api/agent/trade/readiness?market=forex&symbol=EURUSD&practice=true"
echo ""
echo "=== market/scan forex ==="
curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"market":"forex"}' "http://127.0.0.1:${PORT}/api/agent/market/scan"
echo ""
