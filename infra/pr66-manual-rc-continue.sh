#!/usr/bin/env bash
set -euo pipefail
RC_DIR=/opt/aichart-rc-pr66-2a06170
LOG=/tmp/pr66-rc-continue.log
: >"$LOG"
cd "$RC_DIR/web"
set -a
source <(grep -E '^(DATABASE_URL|REDIS_URL|ENCRYPTION_KEY|AICHART_SERVICE_TOKEN|OANDA_|ANTHROPIC_|GEMINI_)' .env | sed 's/\r$//')
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== lint existing changed first-party ===" | tee -a "$LOG"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
EXISTING=()
for f in "${CHANGED[@]:-}"; do
  [ -f "$f" ] && EXISTING+=("$f")
done
echo "existing_changed=${#EXISTING[@]}" | tee -a "$LOG"
if [ "${#EXISTING[@]}" -gt 0 ]; then
  if npx eslint "${EXISTING[@]}" >>"$LOG" 2>&1; then
    echo "PASS lint-changed-existing" | tee -a "$LOG"
  else
    echo "FAIL lint-changed-existing" | tee -a "$LOG"
    grep -E 'error|✖' "$LOG" | tail -30 | tee -a "$LOG"
  fi
else
  echo "PASS lint-changed-existing (none)" | tee -a "$LOG"
fi

echo "=== test:ci with isolated redis+pg ===" | tee -a "$LOG"
if npm run test:ci >>"$LOG" 2>&1; then
  echo "PASS web-test-ci" | tee -a "$LOG"
else
  echo "FAIL web-test-ci" | tee -a "$LOG"
  grep -E '^# (fail|tests|pass|skipped)|not ok ' "$LOG" | tail -40 | tee -a "$LOG"
fi

echo "=== openai key presence (name only) ===" | tee -a "$LOG"
if grep -q '^OPENAI_API_KEY=' .env; then echo "OPENAI_PRESENT=yes" | tee -a "$LOG"; else echo "OPENAI_PRESENT=no" | tee -a "$LOG"; fi
if [ -n "${OPENAI_API_KEY:-}" ]; then echo "OPENAI_IN_ENV=yes" | tee -a "$LOG"; else echo "OPENAI_IN_ENV=no" | tee -a "$LOG"; fi

grep -E '^(PASS|FAIL|OPENAI_)' "$LOG" | tee /tmp/pr66-rc-continue-summary.txt
