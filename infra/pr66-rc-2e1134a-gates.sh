#!/usr/bin/env bash
# Mandatory gates for PR66 head 2e1134a.
set -uo pipefail
RC_SHA=2e1134aba42136af3e2a810dec5ca09175414529
RC_DIR=/opt/aichart-rc-pr66-2e1134a
LOG=/tmp/pr66-2e1134a-gates.log
SUM=/tmp/pr66-2e1134a-gates-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA" || { echo "HEAD_MISMATCH"; exit 2; }
echo "HEAD=$(git rev-parse HEAD)" | tee -a "$LOG"

echo "=== npm ci web ===" | tee -a "$LOG"
cd "$RC_DIR/web"
if npm ci >>"$LOG" 2>&1; then pass "web-npm-ci"; else fail "web-npm-ci"; fi

echo "=== npm ci mcp ===" | tee -a "$LOG"
cd "$RC_DIR/mcp"
if npm ci >>"$LOG" 2>&1; then pass "mcp-npm-ci"; else fail "mcp-npm-ci"; fi

cd "$RC_DIR/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== schema version contract ===" | tee -a "$LOG"
if npx tsx --test --test-force-exit src/lib/db/__tests__/schemaVersionContract.test.ts >>"$LOG" 2>&1; then
  pass "schema-version-contract"
else
  fail "schema-version-contract"
fi

echo "=== lint existing changed first-party ===" | tee -a "$LOG"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
EXIST=()
for f in "${CHANGED[@]:-}"; do [[ -f "$f" ]] && EXIST+=("$f"); done
echo "changed=${#CHANGED[@]} existing=${#EXIST[@]}" | tee -a "$LOG"
if [ "${#EXIST[@]}" -gt 0 ] && npx eslint "${EXIST[@]}" >>"$LOG" 2>&1; then
  pass "lint-changed-first-party"
else
  if [ "${#EXIST[@]}" -eq 0 ]; then pass "lint-changed-first-party-empty"; else fail "lint-changed-first-party"; fi
fi

if npx tsc --noEmit >>"$LOG" 2>&1; then pass "web-tsc"; else fail "web-tsc"; fi
if npm run build >>"$LOG" 2>&1; then pass "web-build"; else fail "web-build"; fi

cd "$RC_DIR/mcp"
if npx tsc --noEmit >>"$LOG" 2>&1; then pass "mcp-tsc"; else fail "mcp-tsc"; fi
if npm run build >>"$LOG" 2>&1; then pass "mcp-build"; else fail "mcp-build"; fi
if npm run schemas:check >>"$LOG" 2>&1; then pass "mcp-schemas-check"; else fail "mcp-schemas-check"; fi
if npm run test:catalog >>"$LOG" 2>&1; then pass "mcp-catalog-tests"; else fail "mcp-catalog-tests"; fi

cd "$RC_DIR/web"
if npm run test:postgres-release >>"$LOG" 2>&1; then pass "postgres-release"; else fail "postgres-release"; fi
if npm run test:redis-release >>"$LOG" 2>&1; then pass "redis-release"; else fail "redis-release"; fi
if npx tsx --test --test-force-exit src/lib/agent/modelFirst/__tests__/*.test.ts >>"$LOG" 2>&1; then
  pass "model-first-suite"
else
  fail "model-first-suite"
fi
if npm run test:decision-authority >>"$LOG" 2>&1; then pass "decision-authority"; else fail "decision-authority"; fi

echo "=== provider-release ===" | tee -a "$LOG"
if npm run test:provider-release >>"$LOG" 2>&1; then pass "provider-release"; else fail "provider-release"; fi
# classify providers
python3 - <<'PY' | tee -a "$LOG" "$SUM"
import json, subprocess
p=subprocess.run(["npx","tsx","scripts/validate-provider-release.ts"], cwd="/opt/aichart-rc-pr66-2e1134a/web", capture_output=True, text=True)
text=p.stdout
idx=text.find('"schemaVersion"')
if idx<0:
    print("provider_parse=fail"); raise SystemExit
while idx>0 and text[idx] != '{': idx-=1
depth=0; end=None
for i,ch in enumerate(text[idx:], idx):
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=i+1; break
data=json.loads(text[idx:end])
for r in data.get("results",[]):
    print(f"provider_{r.get('provider')}={r.get('state')}:{r.get('code')}")
print("provider_ok="+str(data.get("ok")))
print("trades_executed="+str(data.get("safety",{}).get("tradesExecuted")))
PY

echo "=== authenticated MCP tools ===" | tee -a "$LOG"
cd "$RC_DIR/mcp"
set -a
# shellcheck disable=SC1091
source .env 2>/dev/null || true
set +a
# Prefer RC web MCP URL if RC server later; for now use production MCP if exposed, else skip if unreachable
if [[ -n "${MCP_TEST_EMAIL:-}" && -n "${MCP_TEST_PASSWORD:-}" ]]; then
  if npm run test:tools >>"$LOG" 2>&1; then pass "mcp-authenticated-tools"; else fail "mcp-authenticated-tools"; fi
else
  skip "mcp-authenticated-tools" "MCP_TEST credentials missing in mcp env"
fi

cd "$RC_DIR/web"
echo "=== historical persistence unit + API adapter smoke ===" | tee -a "$LOG"
if npx tsx --test --test-force-exit \
  src/lib/agent/modelFirst/__tests__/modelPlanPersistence.test.ts \
  src/lib/recommendations/__tests__/recommendationStore.test.ts \
  >>"$LOG" 2>&1; then pass "historical-persistence-unit"; else fail "historical-persistence-unit"; fi

# Seed sanitized Candidate-backed historical row into isolated PG and read via store APIs
if npx tsx scripts/../scripts/validate-postgres-release.ts >/dev/null 2>&1; then :; fi
python3 - <<'PY' >>"$LOG" 2>&1 || true
print("historical_http_browser=deferred_to_browser_gate")
PY

echo "=== test:ci ===" | tee -a "$LOG"
if npm run test:ci >>"$LOG" 2>&1; then pass "web-test-ci"; else fail "web-test-ci"; fi

# Browser / EA explicit status
if grep -q '^PASS provider-release' "$SUM"; then
  :
else
  if grep -q 'provider_execution=failed:ea_connection_missing_or_revoked' "$SUM" || grep -q 'provider_execution=failed:ea_' "$LOG"; then
    fail "ea-probe"
  elif grep -q 'provider_execution=failed:ea_probe_user_not_configured' "$SUM"; then
    fail "ea-probe"
  else
    fail "ea-probe"
  fi
fi

skip "browser-matrix" "requires RC preview server + authenticated browser run next phase"
skip "manual-review-approval" "operator approval not yet recorded on final head"

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM" | tee -a "$LOG"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
