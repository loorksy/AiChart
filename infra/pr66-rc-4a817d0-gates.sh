#!/usr/bin/env bash
# Code + PG + Redis gates for PR66 head 4a817d0. Records pass/fail/skip.
set -euo pipefail
RC_SHA=4a817d082208eb4fdc6e3f238d5940979b6be5e1
RC_DIR=/opt/aichart-rc-pr66-4a817d0
LOG=/tmp/pr66-4a817d0-gates.log
SUM=/tmp/pr66-4a817d0-gates-summary.txt
: >"$LOG"
: >"$SUM"

pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA"
echo "HEAD=$(git rev-parse HEAD)" | tee -a "$LOG"

echo "=== npm ci web ===" | tee -a "$LOG"
cd "$RC_DIR/web"
if npm ci --omit=dev=false >>"$LOG" 2>&1; then pass "web-npm-ci"; else fail "web-npm-ci"; fi

echo "=== npm ci mcp ===" | tee -a "$LOG"
cd "$RC_DIR/mcp"
if npm ci >>"$LOG" 2>&1; then pass "mcp-npm-ci"; else fail "mcp-npm-ci"; fi

# Prefer-const / first-party lint on changed files
cd "$RC_DIR/web"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
echo "changed_first_party_count=${#CHANGED[@]}" | tee -a "$LOG"
if [ "${#CHANGED[@]}" -gt 0 ]; then
  if npx eslint "${CHANGED[@]}" >>"$LOG" 2>&1; then pass "lint-changed-first-party"; else fail "lint-changed-first-party"; fi
else
  pass "lint-changed-first-party-empty"
fi

# Explicit prefer-const file from fix commit
if npx eslint src/app/api/agent/recommendation/route.ts >>"$LOG" 2>&1; then
  pass "lint-prefer-const-route"
else
  fail "lint-prefer-const-route"
fi

# TypeScript
if npx tsc --noEmit >>"$LOG" 2>&1; then pass "web-tsc"; else fail "web-tsc"; fi

# Production build
if npm run build >>"$LOG" 2>&1; then pass "web-build"; else fail "web-build"; fi

# MCP
cd "$RC_DIR/mcp"
if npx tsc --noEmit >>"$LOG" 2>&1; then pass "mcp-tsc"; else fail "mcp-tsc"; fi
if npm run build >>"$LOG" 2>&1; then pass "mcp-build"; else fail "mcp-build"; fi
if npm run schemas:check >>"$LOG" 2>&1; then pass "mcp-schemas-check"; else fail "mcp-schemas-check"; fi
if npm test >>"$LOG" 2>&1; then pass "mcp-catalog-tests"; else fail "mcp-catalog-tests"; fi

# Load RC env
cd "$RC_DIR/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

# Postgres release validator (claimed fix)
if npm run test:postgres-release >>"$LOG" 2>&1; then pass "postgres-release"; else fail "postgres-release"; fi

# Redis release validator
if npm run test:redis-release >>"$LOG" 2>&1; then pass "redis-release"; else fail "redis-release"; fi

# Model-first / authority suites
if npx tsx --test --test-force-exit \
  src/lib/agent/modelFirst/__tests__/freeModelAuthority.test.ts \
  src/lib/agent/modelFirst/__tests__/*.test.ts \
  >>"$LOG" 2>&1; then pass "model-first-suite"; else fail "model-first-suite"; fi

# Provider (needs OPENAI)
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  if npm run test:provider-release >>"$LOG" 2>&1; then pass "provider-release"; else fail "provider-release"; fi
else
  skip "provider-release" "OPENAI_API_KEY missing in RC env"
fi

# Authenticated MCP / EA / browser blocked without identities
skip "authenticated-mcp" "MCP_TEST_EMAIL missing"
skip "ea-probe" "EA probe identity missing"
skip "browser-qualification" "dedicated web test account missing"
skip "historical-browser-adapter" "dedicated web test account missing"

# Full test:ci (long)
echo "=== test:ci ===" | tee -a "$LOG"
if npm run test:ci >>"$LOG" 2>&1; then pass "web-test-ci"; else fail "web-test-ci"; fi

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM" | tee -a "$LOG"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
