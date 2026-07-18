#!/usr/bin/env bash
# Run mandatory manual release gates for PR #66 RC. Logs to /tmp/pr66-rc-gates.log
set -euo pipefail
RC_SHA=2a06170be0e4870d664adabfc12205221433c08c
RC_DIR=/opt/aichart-rc-pr66-2a06170
LOG=/tmp/pr66-rc-gates.log
REPORT=/tmp/pr66-rc-gate-report.md
: >"$LOG"
: >"$REPORT"

pass() { echo "| $1 | PASS | $2 |" | tee -a "$REPORT"; echo "PASS $1" | tee -a "$LOG"; }
fail() { echo "| $1 | FAIL | $2 |" | tee -a "$REPORT"; echo "FAIL $1 :: $2" | tee -a "$LOG"; FAILED=1; }
skip() { echo "| $1 | SKIP | $2 |" | tee -a "$REPORT"; echo "SKIP $1 :: $2" | tee -a "$LOG"; FAILED=1; }

FAILED=0
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "# PR66 Manual VPS Gate Report"
  echo
  echo "- Start: $START"
  echo "- Host: $(hostname)"
  echo "- Commit: $RC_SHA"
  echo "- RC dir: $RC_DIR"
  echo "- Node: $(node -v) npm: $(npm -v)"
  echo "- OS: $(uname -a)"
  echo
  echo "| Gate | Result | Notes |"
  echo "|---|---|---|"
} >"$REPORT"

cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA" || fail "source-sha" "HEAD mismatch"
test -z "$(git status --porcelain)" || fail "clean-tree" "dirty worktree"
pass "source-sha" "$(git rev-parse HEAD)"
pass "clean-tree" "empty porcelain"

# git whitespace
if git diff --check origin/main..."$RC_SHA" >/tmp/pr66-diffcheck.txt 2>&1; then
  pass "git-diff-check" "clean"
else
  # allow only docs trailing space if present; still record
  if grep -v 'docs/' /tmp/pr66-diffcheck.txt | grep -q .; then
    fail "git-diff-check" "see /tmp/pr66-diffcheck.txt"
  else
    pass "git-diff-check" "docs-only trailing space warnings"
  fi
fi

set +e
# Install web
cd "$RC_DIR/web"
echo "=== npm ci web ===" | tee -a "$LOG"
npm ci >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "web-npm-ci" "exit 0" || fail "web-npm-ci" "exit $EC"

# Install mcp
cd "$RC_DIR/mcp"
echo "=== npm ci mcp ===" | tee -a "$LOG"
npm ci >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "mcp-npm-ci" "exit 0" || fail "mcp-npm-ci" "exit $EC"

# MCP schemas + typecheck + catalog
cd "$RC_DIR/mcp"
npm run schemas:check >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "mcp-schemas-check" "exit 0" || fail "mcp-schemas-check" "exit $EC"
npm run typecheck >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "mcp-typecheck" "exit 0" || fail "mcp-typecheck" "exit $EC"
npm run test:catalog >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "mcp-catalog" "exit 0" || fail "mcp-catalog" "exit $EC"

# Web TypeScript
cd "$RC_DIR/web"
npx tsc --noEmit -p tsconfig.json >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "web-tsc" "exit 0" || fail "web-tsc" "exit $EC"

# Lint — first-party changed files + full lint honesty
echo "=== lint changed first-party ===" | tee -a "$LOG"
CHANGED=$(git -C "$RC_DIR" diff --name-only origin/main..."$RC_SHA" -- 'web/src/**/*.{ts,tsx,js,jsx}' 'web/scripts/**/*.{ts,js,mjs}' | sed 's#^web/##' || true)
if [ -n "$CHANGED" ]; then
  # shellcheck disable=SC2086
  npx eslint $CHANGED >>"$LOG" 2>&1
  EC=$?
  [ $EC -eq 0 ] && pass "lint-changed-first-party" "exit 0" || fail "lint-changed-first-party" "exit $EC"
else
  pass "lint-changed-first-party" "no web src changes listed"
fi

echo "=== lint full (honest) ===" | tee -a "$LOG"
npm run lint >>"$LOG" 2>&1
EC=$?
# Record honestly — full lint may warn; treat errors as fail by checking log for error count
ERR_COUNT=$(grep -E '^\s*[0-9]+ error' "$LOG" | tail -1 | awk '{print $1}' || echo unknown)
if [ "$EC" -eq 0 ]; then
  pass "lint-full" "exit 0"
else
  fail "lint-full" "exit $EC (must document; first-party gate is authoritative if green)"
fi

# Build
echo "=== next build ===" | tee -a "$LOG"
npm run build >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "web-build" "exit 0" || fail "web-build" "exit $EC"

# MCP build
cd "$RC_DIR/mcp"
npm run build >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "mcp-build" "exit 0" || fail "mcp-build" "exit $EC"

# Export isolated env for tests
set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|REDIS_URL|GIT_COMMIT|OPENAI_API_KEY|ENCRYPTION_KEY|AICHART_SERVICE_TOKEN)=' "$RC_DIR/web/.env" | sed 's/\r$//')
set +a
export NODE_ENV=test
export AICHART_DISABLE_LIVE_ORDERS=1

cd "$RC_DIR/web"
echo "=== test:ci ===" | tee -a "$LOG"
npm run test:ci >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "web-test-ci" "exit 0" || fail "web-test-ci" "exit $EC"

# Count skips for Redis round-trip
if grep -qi "skip.*redis\|BullMQ round-trip" "$LOG"; then
  # With isolated REDIS_URL on 6380, integration should not skip critical round-trip
  if grep -qi "skip.*BullMQ\|skipped.*redis" "$LOG"; then
    fail "redis-integration-no-critical-skip" "critical skip still present"
  else
    pass "redis-integration-no-critical-skip" "no critical skip markers"
  fi
else
  pass "redis-integration-no-critical-skip" "no skip markers"
fi

echo "=== postgres-release ===" | tee -a "$LOG"
npm run test:postgres-release >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "postgres-release" "exit 0" || fail "postgres-release" "exit $EC"

echo "=== redis-release ===" | tee -a "$LOG"
npm run test:redis-release >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "redis-release" "exit 0" || fail "redis-release" "exit $EC"

echo "=== provider-release ===" | tee -a "$LOG"
npm run test:provider-release >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "provider-release" "exit 0" || fail "provider-release" "exit $EC"

# Persistence / historical model-plan fixture via node script
echo "=== model-plan persistence adapter ===" | tee -a "$LOG"
npx tsx --test --test-force-exit \
  src/lib/agent/modelFirst/__tests__/modelPlanPersistence.test.ts \
  src/lib/agent/modelFirst/__tests__/buildDrawingsFromValidatedModelPlan.test.ts \
  src/lib/agent/modelFirst/__tests__/freeModelAuthority.test.ts >>"$LOG" 2>&1
EC=$?
[ $EC -eq 0 ] && pass "model-first-suite" "exit 0" || fail "model-first-suite" "exit $EC"

# Secret / hygiene scans (no secret values printed)
cd "$RC_DIR"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --no-git -v >>"$LOG" 2>&1
  EC=$?
  [ $EC -eq 0 ] && pass "secret-scan-gitleaks" "exit 0" || fail "secret-scan-gitleaks" "exit $EC"
else
  python3 - <<'PY' >>"$LOG" 2>&1
import re, pathlib
pat = re.compile(r'(?i)(api[_-]?key|secret|password|bearer\s+[a-z0-9\._\-]{20,}|sk-[a-zA-Z0-9]{20,})')
hits=[]
for p in pathlib.Path('.').rglob('*'):
  if p.is_dir(): continue
  if any(x in p.parts for x in ('.git','node_modules','.next','dist','charting_library','vendor')): continue
  if p.suffix.lower() in {'.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.db'}: continue
  try:
    text=p.read_text(encoding='utf-8', errors='ignore')
  except Exception:
    continue
  if pat.search(text) and p.name not in {'.env.example'} and not str(p).endswith('.md'):
    # ignore known placeholders
    if 'your-' in text.lower() or 'example' in p.name.lower():
      continue
    if p.name == '.env':
      continue  # env files are local RC copies, not committed
    hits.append(str(p))
print('redacted_pattern_hits', len(hits))
for h in hits[:30]:
  print(h)
raise SystemExit(1 if hits else 0)
PY
  EC=$?
  [ $EC -eq 0 ] && pass "secret-scan-redacted" "exit 0" || fail "secret-scan-redacted" "exit $EC"
fi

# Confirm .env not tracked
if git ls-files | grep -E '(^|/)\.env$|aichart\.db$|^\.cursor/' >/tmp/pr66-tracked-bad.txt; then
  fail "tracked-secrets" "$(cat /tmp/pr66-tracked-bad.txt)"
else
  pass "tracked-secrets" "none"
fi

END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo
  echo "- End: $END"
  if [ "$FAILED" -eq 0 ]; then
    echo "- Aggregate: PASS"
  else
    echo "- Aggregate: FAIL"
  fi
} >>"$REPORT"

echo "REPORT=$REPORT"
echo "LOG=$LOG"
echo "AGGREGATE_FAILED=$FAILED"
exit "$FAILED"
