#!/usr/bin/env bash
ps aux | grep -E 'validate-provider|seed-and-retest' | grep -v grep || echo no_prov_proc
wc -c /tmp/prov2.out 2>/dev/null || echo no_out
python3 - <<'PY'
from pathlib import Path
import json, re
p=Path('/tmp/prov2.out')
if not p.exists():
    print('no_out'); raise SystemExit
text=p.read_text(encoding='utf-8', errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+', 'postgresql://REDACTED', text)
idx=text.find('"schemaVersion"')
print('bytes', p.stat().st_size, 'json', idx>=0)
if idx<0:
    print(text[-800:]); raise SystemExit
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
