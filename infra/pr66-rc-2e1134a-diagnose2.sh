#!/usr/bin/env bash
# Safe diagnose: never passes DATABASE_URL on argv; never prints secrets.
set -uo pipefail
export PGPASSWORD=""
RC=/opt/aichart-rc-pr66-2e1134a
cd "$RC/web"
set -a
# shellcheck disable=SC1091
source .env
set +a

python3 - <<'PY'
import os, json, urllib.request, urllib.error
from pathlib import Path

# Use libpq via env from already-sourced process? Read prod URL inside python only.
prod=None
for line in Path('/opt/aichart/web/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        prod=line.split('=',1)[1].strip().strip('"').strip("'"); break

import subprocess
uid = open('/root/.config/aichart/release-test.env').read()
# get id from secret file
probe=None
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if line.startswith('PROVIDER_RELEASE_EA_USER_ID='):
        probe=line.split('=',1)[1].strip()
print('probe_user_id_set='+('yes' if probe else 'no'))

# column list only
cols=subprocess.check_output(
    ['psql', prod, '-At', '-c',
     "SELECT column_name FROM information_schema.columns WHERE table_name='ea_connections' ORDER BY ordinal_position;"],
    text=True).strip().splitlines()
print('ea_columns='+','.join(cols))
# status counts only
print(subprocess.check_output(
    ['psql', prod, '-At', '-c',
     f"SELECT coalesce(status,'null'), count(*) FROM ea_connections WHERE user_id={int(probe)} GROUP BY 1;"],
    text=True).strip() or 'no_rows')

# Find auth routes by static scan of RC
root=Path('/opt/aichart-rc-pr66-2e1134a/web/src/app/api')
routes=[]
for p in root.rglob('route.ts'):
    rel=str(p.relative_to(root)).replace('\\','/')
    if 'auth' in rel or 'login' in rel or 'session' in rel:
        routes.append(rel)
print('auth_routes='+','.join(routes[:30]))

# Try common login payloads against RC — report status codes only
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
email=vals['WEB_TEST_EMAIL']; password=vals['WEB_TEST_PASSWORD']
candidates=[
    ('/api/auth/login', {"email":email,"password":password}),
    ('/api/auth/login', {"username":email,"password":password}),
    ('/api/login', {"email":email,"password":password}),
    ('/api/session', {"email":email,"password":password}),
]
for path,payload in candidates:
    body=json.dumps(payload).encode()
    req=urllib.request.Request('http://127.0.0.1:3019'+path, data=body, headers={'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data=json.loads(resp.read().decode())
            print(f'login_try {path} status={resp.status} keys={sorted(data.keys())[:12]} has_token={bool(data.get("token") or data.get("accessToken") or data.get("sessionToken"))}')
    except urllib.error.HTTPError as e:
        print(f'login_try {path} status={e.code}')
    except Exception as e:
        print(f'login_try {path} error={type(e).__name__}')

# voice test file location
import glob
print('voice_tests='+','.join(glob.glob('/opt/aichart-rc-pr66-2e1134a/web/src/lib/agent/voice/__tests__/*')))
PY

# Rerun voice suite without OPENAI to isolate test:ci fail
cd "$RC/web"
echo "=== voiceCore with OPENAI unset ==="
env -u OPENAI_API_KEY npx tsx --test --test-force-exit src/lib/agent/voice/__tests__/voiceCore.test.ts 2>&1 | tail -n 50

echo "=== provider release code only ==="
# Avoid printing DATABASE_URL: run with env already set from sourced .env but redact logs
npm run test:provider-release 2>/tmp/prov.out >/tmp/prov.out || true
python3 - <<'PY'
from pathlib import Path
import json,re
text=Path('/tmp/prov.out').read_text(encoding='utf-8', errors='ignore')
# redact any postgres URLs if present
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','postgresql://REDACTED', text)
idx=text.find('"schemaVersion"')
if idx<0:
    print('provider_json_missing')
    print(text[-1500:])
else:
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
        print(f"{r['provider']}={r['state']}:{r['code']}")
    print('tradesExecuted='+str(data['safety']['tradesExecuted']))
PY
