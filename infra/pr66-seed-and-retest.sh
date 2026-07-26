#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart-rc-pr66-2e1134a/web
node /tmp/pr66-seed-isolated-test-user.mjs

python3 - <<'PY'
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
body=json.dumps({'email': vals['WEB_TEST_EMAIL'], 'password': vals['WEB_TEST_PASSWORD']}).encode()
req=urllib.request.Request('http://127.0.0.1:3019/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        data=json.loads(resp.read().decode())
        print('web_login=ok', 'has_token', bool(data.get('token')))
except urllib.error.HTTPError as e:
    print('web_login=http_error', e.code)
except Exception as e:
    print('web_login=fail', type(e).__name__)
PY

set -a
# shellcheck disable=SC1091
source .env
set +a
export AICHART_DISABLE_LIVE_ORDERS=1
npm run test:provider-release > /tmp/prov2.out 2>&1 || true
python3 - <<'PY'
from pathlib import Path
import json, re
text = Path('/tmp/prov2.out').read_text(encoding='utf-8', errors='ignore')
text = re.sub(r'postgres(?:ql)?://[^\s\"\']+', 'postgresql://REDACTED', text)
idx = text.find('"schemaVersion"')
if idx < 0:
    print('provider_json_missing')
    print(text[-1200:])
    raise SystemExit
while idx > 0 and text[idx] != '{':
    idx -= 1
depth = 0
end = None
for i, ch in enumerate(text[idx:], idx):
    if ch == '{':
        depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
data = json.loads(text[idx:end])
for r in data['results']:
    print(f"{r['provider']}={r['state']}:{r['code']}")
print('tradesExecuted=' + str(data['safety']['tradesExecuted']))
PY
