#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY'
import json, urllib.request, urllib.error
from pathlib import Path
vals={}
for line in Path('/root/.config/aichart/release-test.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1); vals[k]=v
email=vals.get('WEB_TEST_EMAIL') or vals.get('MCP_TEST_EMAIL')
password=vals.get('WEB_TEST_PASSWORD') or vals.get('MCP_TEST_PASSWORD')
print('email_configured', bool(email))
print('password_configured', bool(password))
body=json.dumps({'email':email,'password':password}).encode()
for base in ['http://127.0.0.1:3019','http://127.0.0.1:3010']:
    try:
        req=urllib.request.Request(base+'/api/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=20) as resp:
            data=json.loads(resp.read().decode())
            print(base, 'login_status', resp.status, 'token', bool(data.get('token')), 'keys', list(data.keys())[:8])
    except urllib.error.HTTPError as e:
        print(base, 'login_status', e.code, e.read().decode()[:200])
    except Exception as e:
        print(base, 'login_err', type(e).__name__, str(e)[:120])
# Probe login HTML
try:
    html=urllib.request.urlopen('http://127.0.0.1:3019/login', timeout=15).read().decode('utf-8','ignore')
    print('login_page_len', len(html))
    for needle in ['type="email"','type="password"','name="email"','تسجيل','Login','/api/auth/login']:
        print('has', needle, needle in html)
except Exception as e:
    print('login_page_err', e)
# Also try /register and root
for path in ['/','/ar','/en','/auth/login','/signin']:
    try:
        r=urllib.request.urlopen('http://127.0.0.1:3019'+path, timeout=10)
        print('GET', path, r.status, r.geturl()[:80])
    except Exception as e:
        print('GET', path, type(e).__name__, getattr(e,'code',str(e)[:60]))
PY
# browser matrix log
tail -n 80 /tmp/pr66-a0a09a8-qualify.log | sed -n '/test:pr66-browser-matrix/,$p' | tail -n 60
ls -la /tmp/pr66-browser-matrix 2>/dev/null || true
