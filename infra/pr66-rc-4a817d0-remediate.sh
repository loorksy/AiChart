#!/usr/bin/env bash
# Remediate environmental false-fails and re-check critical gates on 4a817d0.
set -euo pipefail
RC_SHA=4a817d082208eb4fdc6e3f238d5940979b6be5e1
RC_DIR=/opt/aichart-rc-pr66-4a817d0
LOG=/tmp/pr66-4a817d0-remediate.log
SUM=/tmp/pr66-4a817d0-remediate-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA"
echo "HEAD=$(git rev-parse HEAD)" | tee -a "$LOG"

# Ensure GIT_COMMIT matches HEAD for health/version
python3 - <<'PY'
from pathlib import Path
sha="4a817d082208eb4fdc6e3f238d5940979b6be5e1"
p=Path("/opt/aichart-rc-pr66-4a817d0/web/.env")
lines=[l for l in p.read_text().splitlines() if not l.startswith("GIT_COMMIT=")]
lines.append("GIT_COMMIT="+sha)
p.write_text("\n".join(lines)+"\n")
print("GIT_COMMIT_SET")
PY

echo "=== recreate clean postgres DB ===" | tee -a "$LOG"
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='aichart_rel_pr66' AND pid <> pg_backend_pid();" >/dev/null || true
sudo -u postgres dropdb --if-exists aichart_rel_pr66
sudo -u postgres createdb aichart_rel_pr66
sudo -u postgres psql -d aichart_rel_pr66 -c 'CREATE EXTENSION IF NOT EXISTS vector;'
DB_USER=$(python3 - <<'PY'
import urllib.parse
from pathlib import Path
db=[l.split("=",1)[1].strip() for l in Path("/opt/aichart/web/.env").read_text().splitlines() if l.startswith("DATABASE_URL=")][0]
print(urllib.parse.urlparse(db).username or "postgres")
PY
)
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE aichart_rel_pr66 TO \"$DB_USER\";"
sudo -u postgres psql -d aichart_rel_pr66 -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
sudo -u postgres psql -d aichart_rel_pr66 -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";"
echo "PG_CLEAN_READY" | tee -a "$LOG"

cd "$RC_DIR/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== lint existing changed first-party ===" | tee -a "$LOG"
mapfile -t CHANGED < <(git -C "$RC_DIR" diff --name-only origin/main...HEAD | grep -E '^web/src/.*\.(ts|tsx)$|^web/scripts/.*\.(ts|js|mjs)$' | sed 's#^web/##' || true)
EXIST=()
for f in "${CHANGED[@]:-}"; do
  [[ -f "$f" ]] && EXIST+=("$f")
done
echo "changed=${#CHANGED[@]} existing=${#EXIST[@]}" | tee -a "$LOG"
if [ "${#EXIST[@]}" -gt 0 ]; then
  if npx eslint "${EXIST[@]}" >>"$LOG" 2>&1; then pass "lint-changed-first-party-existing"; else fail "lint-changed-first-party-existing"; fi
else
  pass "lint-changed-first-party-existing-empty"
fi
if npx eslint src/app/api/agent/recommendation/route.ts >>"$LOG" 2>&1; then pass "lint-prefer-const-route"; else fail "lint-prefer-const-route"; fi

echo "=== postgres-release on clean DB ===" | tee -a "$LOG"
if npm run test:postgres-release >>"$LOG" 2>&1; then pass "postgres-release"; else fail "postgres-release"; fi

echo "=== redis-release rerun ===" | tee -a "$LOG"
if npm run test:redis-release >>"$LOG" 2>&1; then pass "redis-release"; else fail "redis-release"; fi

echo "=== mcp test:catalog ===" | tee -a "$LOG"
cd "$RC_DIR/mcp"
if npm run test:catalog >>"$LOG" 2>&1; then pass "mcp-catalog-tests"; else fail "mcp-catalog-tests"; fi

cd "$RC_DIR/web"
echo "=== version identity test ===" | tee -a "$LOG"
if npx tsx --test --test-force-exit src/lib/__tests__/version.test.ts >>"$LOG" 2>&1; then pass "version-test"; else fail "version-test"; fi

echo "=== provider-release (OpenAI expected; EA expected fail without identity) ===" | tee -a "$LOG"
if npm run test:provider-release >>"$LOG" 2>&1; then pass "provider-release"; else
  fail "provider-release"
  # classify: if only EA failed, note that
  python3 - <<'PY' >>"$LOG"
import json,re,subprocess,os
from pathlib import Path
# re-run capturing JSON only
import subprocess
p=subprocess.run(["npx","tsx","scripts/validate-provider-release.ts"], cwd="/opt/aichart-rc-pr66-4a817d0/web", capture_output=True, text=True)
text=p.stdout
# find last JSON object
start=text.rfind('{')
# better: find schemaVersion
idx=text.find('"schemaVersion"')
if idx<0:
  print('provider_parse=fail')
else:
  # walk back to {
  while idx>0 and text[idx] != '{': idx-=1
  try:
    # naive brace match
    depth=0
    end=None
    for i,ch in enumerate(text[idx:], idx):
      if ch=='{': depth+=1
      elif ch=='}':
        depth-=1
        if depth==0:
          end=i+1
          break
    data=json.loads(text[idx:end])
  except Exception as e:
    print('provider_parse_error',e)
    raise SystemExit
  for r in data.get('results',[]):
    print(f"provider_{r.get('provider')}={r.get('state')}:{r.get('code')}")
  print('provider_ok='+str(data.get('ok')))
  print('trades_executed='+str(data.get('safety',{}).get('tradesExecuted')))
PY
fi

echo "=== historical candidate adapter unit path ===" | tee -a "$LOG"
if npx tsx --test --test-force-exit \
  src/lib/agent/modelFirst/__tests__/modelPlanPersistence.test.ts \
  src/lib/recommendations/__tests__/recommendationStore.test.ts \
  >>"$LOG" 2>&1; then pass "historical-persistence-unit"; else fail "historical-persistence-unit"; fi

# Still blocked identities
skip "authenticated-mcp" "MCP_TEST_EMAIL missing"
skip "ea-probe" "EA_PROBE_USER_ID missing"
skip "browser-qualification" "dedicated web test account missing"
skip "historical-browser-adapter" "dedicated web test account missing"
skip "manual-review-approval" "operator approval not recorded on PR for this head"

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
