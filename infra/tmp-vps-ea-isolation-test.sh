#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
export AICHART_SERVICE_TOKEN
AICHART_SERVICE_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' web/.env | cut -d= -f2-)"
echo "FOREX_BACKEND=$(grep '^FOREX_BACKEND=' web/.env | cut -d= -f2- || echo '(unset)')"
echo "SINGLE_USER=$(grep '^AICHART_SINGLE_USER=' web/.env | cut -d= -f2-)"
echo "REDIS_URL=$(grep '^REDIS_URL=' web/.env | cut -d= -f2- | cut -c1-40)..."
export BRIDGE_TEST_USER_A
BRIDGE_TEST_USER_A="$(sudo -u postgres psql -d aichart -t -A -c "SELECT email FROM users WHERE role='admin' LIMIT 1;" | tr -d '[:space:]')"
export BRIDGE_TEST_USER_B
BRIDGE_TEST_USER_B="$(sudo -u postgres psql -d aichart -t -A -c "SELECT email FROM users WHERE role='user' AND email NOT LIKE '%telegram.user%' ORDER BY id DESC LIMIT 1;" | tr -d '[:space:]')"
echo "Testing EA isolation: $BRIDGE_TEST_USER_A vs $BRIDGE_TEST_USER_B"
echo "--- ea_connections ---"
sudo -u postgres psql -d aichart -c "SELECT user_id, status, account_login, last_heartbeat_at FROM ea_connections ORDER BY user_id;"
python3 infra/tmp-test-ea-isolation.py
