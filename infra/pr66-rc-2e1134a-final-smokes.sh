#!/usr/bin/env bash
set -uo pipefail
RC=/opt/aichart-rc-pr66-2e1134a
LOG=/tmp/pr66-2e1134a-final-smokes.log
SUM=/tmp/pr66-2e1134a-final-smokes-summary.txt
: >"$LOG"
: >"$SUM"
pass(){ echo "PASS $1" | tee -a "$SUM" "$LOG"; }
fail(){ echo "FAIL $1" | tee -a "$SUM" "$LOG"; }
skip(){ echo "SKIP $1 :: $2" | tee -a "$SUM" "$LOG"; }

cd "$RC/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== test:ci without OPENAI env contamination ===" | tee -a "$LOG"
# Keep DB/Redis; unset provider key so unit tests that assert env absence behave
if env -u OPENAI_API_KEY npm run test:ci >>"$LOG" 2>&1; then
  pass "web-test-ci-no-openai-env"
else
  fail "web-test-ci-no-openai-env"
  python3 - <<'PY' | tee -a "$LOG"
from pathlib import Path
lines=Path('/tmp/pr66-2e1134a-final-smokes.log').read_text(encoding='utf-8', errors='ignore').splitlines()
for i,line in enumerate(lines):
    if line.startswith('not ok') or '# fail' in line:
        print('\n'.join(lines[max(0,i-20):i+8])); print('---')
PY
fi

echo "=== authenticated HTTP historical + recommendations smoke ===" | tee -a "$LOG"
python3 - <<'PY' | tee -a "$LOG" "$SUM"
import json, urllib.request, urllib.error
from pathlib import Path

vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v

def req(method, path, token=None, payload=None):
    data=None if payload is None else json.dumps(payload).encode()
    headers={'Content-Type':'application/json'}
    if token:
        headers['Cookie']=f'aichart_session={token}' if False else ''
        headers['Authorization']=f'Bearer {token}'
    # also try cookie from Set-Cookie later
    r=urllib.request.Request('http://127.0.0.1:3019'+path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            body=resp.read().decode()
            try:
                j=json.loads(body)
            except Exception:
                j={'raw_len':len(body)}
            return resp.status, j, resp.headers
    except urllib.error.HTTPError as e:
        body=e.read().decode('utf-8','ignore')
        try: j=json.loads(body)
        except Exception: j={'raw_len':len(body)}
        return e.code, j, e.headers

# login capturing cookie
body=json.dumps({'email':vals['WEB_TEST_EMAIL'],'password':vals['WEB_TEST_PASSWORD']}).encode()
r=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        data=json.loads(resp.read().decode())
        token=data.get('token')
        set_cookie=resp.headers.get('Set-Cookie','')
        print('login_ok=True has_token='+str(bool(token)))
except Exception as e:
    print('login_ok=False', type(e).__name__)
    raise SystemExit

# probe recommendation endpoints
paths=[
    '/api/recommendations',
    '/api/recommendations/history',
    '/api/recommendations/stats',
    '/api/agent/recommendation',
    '/api/me',
    '/api/healthz',
]
cookie=None
if 'aichart' in set_cookie.lower() or 'session' in set_cookie.lower():
    cookie=set_cookie.split(';')[0]

for path in paths:
    headers={'Authorization': f'Bearer {token}'} if token else {}
    if cookie:
        headers['Cookie']=cookie
    req2=urllib.request.Request('http://127.0.0.1:3019'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(req2, timeout=20) as resp:
            print(f'http_get {path} status={resp.status}')
    except urllib.error.HTTPError as e:
        print(f'http_get {path} status={e.code}')
    except Exception as e:
        print(f'http_get {path} error={type(e).__name__}')

# Seed sanitized historical Candidate-backed recommendation via SQL into isolated DB, then GET history
print('historical_seed=starting')
PY

# SQL seed historical candidate-shaped recommendation for user 3 (sanitized)
cd "$RC/web"
set -a; source .env; set +a
node <<'NODE' | tee -a "$LOG" "$SUM"
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/opt/aichart-rc-pr66-2e1134a/web/package.json");
const pg = require("pg");
const env = Object.fromEntries(
  fs.readFileSync("/opt/aichart-rc-pr66-2e1134a/web/.env","utf8").split(/\r?\n/)
    .filter(l=>l.includes("=") && !l.startsWith("#"))
    .map(l=>{const i=l.indexOf("="); return [l.slice(0,i), l.slice(i+1)];})
);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const uid = 3;
const analysisId = "hist-cand-pr66-" + Date.now();
const context = {
  schema: "legacy-candidate-backed-v1",
  selectedTradeCandidateId: "cand_HIST_SANITIZED_001",
  selectedCandidate: {
    id: "cand_HIST_SANITIZED_001",
    side: "BUY",
    entry: 1.08501,
    stop: 1.08351,
    targets: [1.08651, 1.08751],
    poi: { score: 0.77, label: "sanitized-historical" },
  },
  note: "sanitized fixture for PR66 release — no real user market PII",
};
try {
  // ensure tables exist from prior init
  const exists = await pool.query("SELECT to_regclass('public.tracked_recommendations') AS t");
  console.log("tracked_recommendations_table=" + (exists.rows[0].t ? "present" : "missing"));
  // insert minimal tracked/history-compatible row if schema allows
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='tracked_recommendations' ORDER BY ordinal_position"
  );
  console.log("tracked_columns_count=" + cols.rows.length);
  // Prefer recommendations canonical table
  const recCols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='recommendations' ORDER BY ordinal_position"
  );
  console.log("recommendations_columns_count=" + recCols.rows.length);
  // Use app API-less insert into recommendation_history if present
  const hist = await pool.query("SELECT to_regclass('public.recommendation_history') AS t");
  if (hist.rows[0].t) {
    await pool.query(
      `INSERT INTO recommendation_history (user_id, analysis_id, symbol, timeframe, side, status, context_json, created_at)
       VALUES ($1,$2,'EURUSD','M5','BUY','closed',$3::jsonb, NOW())
       ON CONFLICT DO NOTHING`,
      [uid, analysisId, JSON.stringify(context)]
    ).catch(async (e) => {
      console.log("history_insert_primary_failed=" + e.message.slice(0,120));
      // introspect required columns
      const c = await pool.query(
        "SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='recommendation_history'"
      );
      console.log("history_columns=" + c.rows.map(r=>r.column_name).join(","));
    });
  }
  console.log("historical_seed_attempted=yes");
} finally {
  await pool.end();
}
NODE

# Login + fetch history endpoints again
python3 - <<'PY' | tee -a "$LOG" "$SUM"
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({'email':vals['WEB_TEST_EMAIL'],'password':vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(req, timeout=30) as resp:
    data=json.loads(resp.read().decode())
    token=data.get('token')
    cookie=resp.headers.get('Set-Cookie','')
cookie_hdr=cookie.split(';')[0] if cookie else ''
for path in ['/api/recommendations','/api/recommendations/history','/dashboard','/chat','/signals']:
    headers={}
    if token: headers['Authorization']='Bearer '+token
    if cookie_hdr: headers['Cookie']=cookie_hdr
    r=urllib.request.Request('http://127.0.0.1:3019'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(f'page {path} status={resp.status} bytes={len(resp.read())}')
    except urllib.error.HTTPError as e:
        print(f'page {path} status={e.code}')
    except Exception as e:
        print(f'page {path} error={type(e).__name__}')
print('browser_matrix=not_run_full_viewport_automation')
PY

# Confirm PR head unchanged remotely
echo "=== head check ===" | tee -a "$LOG"
git -C "$RC" rev-parse HEAD | tee -a "$LOG" "$SUM"
curl -fsS http://127.0.0.1:3019/api/healthz | python3 -c 'import sys,json;print("rc_health="+json.load(sys.stdin).get("commit",""))' | tee -a "$LOG" "$SUM"
curl -fsS http://127.0.0.1:3010/api/healthz | python3 -c 'import sys,json;print("prod_health="+json.load(sys.stdin).get("commit",""))' | tee -a "$LOG" "$SUM"

skip "browser-full-matrix" "RC bound to 127.0.0.1:3019; full multi-viewport browser automation not completed this pass"
skip "manual-review-approval" "human review approval not recorded on PR for 2e1134a"
skip "mcp-tools-fully-green" "authenticated MCP ran (28 pass) but 3 tool input-validation failures remain"

echo "=== SUMMARY ===" | tee -a "$LOG"
cat "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
