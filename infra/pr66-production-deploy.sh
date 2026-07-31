#!/usr/bin/env bash
# Production deploy of merged PR #66 — exact origin/main merge commit.
set -euo pipefail
EXPECTED_MERGE="${EXPECTED_MERGE:-522e372866d606cafe8ceb40ff2615d68d2807e0}"
ROLLBACK="${ROLLBACK:-d995fdf52ab2983bc116407999777048ee9396e8}"
LOG=/tmp/pr66-production-deploy.log
SUM=/tmp/pr66-production-deploy-summary.txt
: >"$LOG"
: >"$SUM"
exec > >(tee -a "$LOG") 2>&1

echo "=== PR66 PRODUCTION DEPLOY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "expected_merge=$EXPECTED_MERGE"
echo "rollback_target=$ROLLBACK"

# Preflight — production currently on rollback SHA
curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/prod_web_before.json
curl -fsS http://127.0.0.1:8787/health | tee /tmp/prod_mcp_before.json
echo
python3 - <<'PY'
import json
w=json.load(open('/tmp/prod_web_before.json'))
m=json.load(open('/tmp/prod_mcp_before.json'))
print('before_web='+w.get('commit',''))
print('before_mcp='+m.get('commit',''))
PY
echo "prod_symlink=$(readlink -f /opt/aichart)"
pm2 list | tee -a "$SUM"

# Stop RC qualifiers that could contend for CPU/disk (not production ports)
pkill -f 'pr66-rc-final-qualify' 2>/dev/null || true
fuser -k 3019/tcp 2>/dev/null || true
fuser -k 8788/tcp 2>/dev/null || true

# Ensure main tip is the merge commit before redeploy
TMP=/tmp/aichart-main-verify
rm -rf "$TMP"
git clone --depth 5 --branch main https://github.com/loorksy/AiChart.git "$TMP"
MAIN_HEAD="$(git -C "$TMP" rev-parse HEAD)"
echo "origin_main_head=$MAIN_HEAD"
if [[ "$MAIN_HEAD" != "$EXPECTED_MERGE" ]]; then
  echo "FATAL: origin/main is not the expected merge commit"
  exit 1
fi

# Deploy via canonical clean-redeploy (backs up PG + env + TV, fresh clone main)
export REPO_URL=https://github.com/loorksy/AiChart.git
export BRANCH=main
export INSTALL_DIR=/opt/aichart
bash /opt/aichart/infra/vps-clean-redeploy.sh GO

# Post verify
curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/prod_web_after.json
curl -fsS http://127.0.0.1:8787/health | tee /tmp/prod_mcp_after.json
echo
python3 - <<PY
import json
w=json.load(open('/tmp/prod_web_after.json'))
m=json.load(open('/tmp/prod_mcp_after.json'))
exp='$EXPECTED_MERGE'
wc=w.get('commit',''); mc=m.get('commit','')
print('after_web='+wc)
print('after_mcp='+mc)
print(('PASS' if wc==exp else 'FAIL')+' web-health-merge-commit')
print(('PASS' if mc==exp else 'FAIL')+' mcp-health-merge-commit')
open('/tmp/pr66-production-deploy-summary.txt','a').write(
  f"after_web={wc}\nafter_mcp={mc}\n"
  f"{'PASS' if wc==exp else 'FAIL'} web-health-merge-commit\n"
  f"{'PASS' if mc==exp else 'FAIL'} mcp-health-merge-commit\n"
)
if wc!=exp or mc!=exp:
  raise SystemExit(2)
PY

# Smoke: login path + recommendations list (no secrets printed)
python3 - <<'PY'
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({'email':vals['WEB_TEST_EMAIL'],'password':vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3010/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
with urllib.request.urlopen(req, timeout=30) as resp:
    data=json.loads(resp.read().decode()); token=data.get('token')
print(('PASS' if token else 'FAIL')+' prod-login-smoke')
headers={'Authorization':'Bearer '+token}
for path in ['/api/recommendations/tracked','/api/recommendations/tracked/stats','/chat']:
    r=urllib.request.Request('http://127.0.0.1:3010'+path, headers=headers, method='GET')
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            print(f'PASS prod-http{path.replace("/","-")} status={resp.status}')
    except urllib.error.HTTPError as e:
        print(f'{"PASS" if e.code<500 else "FAIL"} prod-http{path.replace("/","-")} status={e.code}')
PY

echo "rollback_target=$ROLLBACK"
echo "deployed_merge=$EXPECTED_MERGE"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
pm2 list
