#!/usr/bin/env bash
set -uo pipefail
RC=/opt/aichart-rc-pr66-2e1134a
LOG=/tmp/pr66-2e1134a-diagnose.log
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1

cd "$RC/web"
set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1

echo "=== EA connection detail for probe user (no secrets) ==="
python3 - <<'PY'
import os, subprocess
from pathlib import Path
# use RC DATABASE_URL (isolated) vs prod - EA lives in prod DB
prod=None
for line in Path('/opt/aichart/web/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        prod=line.split('=',1)[1].strip().strip('"').strip("'"); break
uid=os.environ.get('PROVIDER_RELEASE_EA_USER_ID') or os.environ.get('AICHART_AGENT_USER_ID')
print('probe_user_id_configured='+('yes' if uid else 'no'))
print('probe_user_id='+str(uid))
q=f"""SELECT id, user_id, coalesce(status,''), coalesce(online::text,''), 
       CASE WHEN account_login IS NULL OR btrim(account_login::text)='' THEN 0 ELSE 1 END AS has_login,
       CASE WHEN last_seen_at IS NULL THEN 'null' ELSE 'set' END AS last_seen
       FROM ea_connections WHERE user_id={int(uid)} ORDER BY id;"""
print(subprocess.check_output(['psql',prod,'-At','-F','|','-c',q], text=True))
PY

echo "=== provider EA-only rerun ==="
# Force execution branch ea and capture code
npm run test:provider-release 2>&1 | python3 - <<'PY'
import sys,json
text=sys.stdin.read()
idx=text.find('"schemaVersion"')
print('found_json', idx>=0)
if idx<0:
    print(text[-2000:]); raise SystemExit
while idx>0 and text[idx]!='{': idx-=1
depth=0; end=None
for i,ch in enumerate(text[idx:], idx):
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=i+1; break
data=json.loads(text[idx:end])
for r in data['results']:
    if r['provider'] in ('execution','openai'):
        print(r['provider'], r['state'], r['code'], r.get('details'))
print('tradesExecuted', data['safety']['tradesExecuted'])
PY

echo "=== voiceSessionConfig failing test ==="
# Run with OPENAI present then without
npx tsx --test --test-force-exit src/lib/agent/voice/__tests__/voiceSessionConfig.test.ts 2>&1 | tail -n 80 || true
echo "--- without OPENAI in env ---"
env -u OPENAI_API_KEY npx tsx --test --test-force-exit src/lib/agent/voice/__tests__/voiceSessionConfig.test.ts 2>&1 | tail -n 40 || true

echo "=== MCP auth summary already known; check login API for web test user ==="
# Login smoke against RC without printing password/token
python3 - <<'PY'
import json, urllib.request, urllib.error, os
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
email=vals.get('WEB_TEST_EMAIL'); password=vals.get('WEB_TEST_PASSWORD')
body=json.dumps({"email": email, "password": password}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        data=json.loads(resp.read().decode())
        print('web_login=ok')
        print('web_login_status', resp.status)
        # never print token; only presence
        print('has_token', bool(data.get('token') or data.get('accessToken') or data.get('session')))
        print('keys', sorted(list(data.keys())[:20]))
except urllib.error.HTTPError as e:
    print('web_login=http_error', e.code)
    body=e.read().decode('utf-8','ignore')[:200]
    print('body_prefix_len', len(body))
except Exception as e:
    print('web_login=fail', type(e).__name__)
PY

echo "DONE"
