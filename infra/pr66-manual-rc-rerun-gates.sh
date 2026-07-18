#!/usr/bin/env bash
set -euo pipefail
RC_DIR=/opt/aichart-rc-pr66-2a06170
LOG=/tmp/pr66-rc-rerun.log
: >"$LOG"

echo "=== fix pgvector ===" | tee -a "$LOG"
sudo -u postgres psql -d aichart_rel_pr66 -c 'CREATE EXTENSION IF NOT EXISTS vector;' | tee -a "$LOG"

echo "=== recreate redis with AOF + everysec + noeviction ===" | tee -a "$LOG"
REDIS_PASS=$(cat /root/aichart-rc-redis-rel.pass)
docker rm -f aichart-redis-rel >/dev/null 2>&1 || true
docker run -d --name aichart-redis-rel --restart unless-stopped \
  -p 127.0.0.1:6380:6379 \
  redis:7-alpine redis-server \
  --requirepass "$REDIS_PASS" \
  --appendonly yes \
  --appendfsync everysec \
  --maxmemory-policy noeviction
sleep 2
docker exec aichart-redis-rel redis-cli -a "$REDIS_PASS" CONFIG GET appendonly | tee -a "$LOG"

cd "$RC_DIR/web"
set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|REDIS_URL|OPENAI_API_KEY|ENCRYPTION_KEY|OANDA_API_KEY|OANDA_ACCOUNT_ID|MT5_BRIDGE_URL|AICHART_SERVICE_TOKEN)=' .env | sed 's/\r$//')
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== postgres-release ===" | tee -a "$LOG"
if npm run test:postgres-release >>"$LOG" 2>&1; then
  echo "PASS postgres-release" | tee -a "$LOG"
else
  echo "FAIL postgres-release" | tee -a "$LOG"
fi

echo "=== redis-release ===" | tee -a "$LOG"
if npm run test:redis-release >>"$LOG" 2>&1; then
  echo "PASS redis-release" | tee -a "$LOG"
else
  echo "FAIL redis-release" | tee -a "$LOG"
fi

echo "=== provider-release ===" | tee -a "$LOG"
if npm run test:provider-release >>"$LOG" 2>&1; then
  echo "PASS provider-release" | tee -a "$LOG"
else
  echo "FAIL provider-release" | tee -a "$LOG"
fi

echo "=== lint changed first-party ===" | tee -a "$LOG"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
echo "changed_count=${#CHANGED[@]}" | tee -a "$LOG"
if [ "${#CHANGED[@]}" -gt 0 ]; then
  if npx eslint "${CHANGED[@]}" >>"$LOG" 2>&1; then
    echo "PASS lint-changed-first-party" | tee -a "$LOG"
  else
    echo "FAIL lint-changed-first-party" | tee -a "$LOG"
  fi
else
  echo "PASS lint-changed-first-party (no files)" | tee -a "$LOG"
fi

echo "=== test:ci targeted failures investigation ===" | tee -a "$LOG"
npx tsx --test --test-force-exit \
  src/lib/agent/voice/__tests__/realtimeClientSecret.test.ts \
  src/lib/__tests__/eaQuoteMetrics.test.ts \
  src/lib/__tests__/eaLiveStateRedis.test.ts \
  src/lib/__tests__/queue.test.ts >>"$LOG" 2>&1 || true
tail -n 80 "$LOG" | tee /tmp/pr66-rc-rerun-tail.txt

echo "DONE" | tee -a "$LOG"
grep -E '^(PASS|FAIL) ' "$LOG" | tee /tmp/pr66-rc-rerun-summary.txt
