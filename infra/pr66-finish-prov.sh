#!/usr/bin/env bash
pkill -f 'validate-provider-release' 2>/dev/null || true
pkill -f 'pr66-seed-and-retest' 2>/dev/null || true
sleep 1
bash /tmp/pr66-check-prov.sh
python3 - <<'PY'
from pathlib import Path
import json, re
text=Path('/tmp/prov2.out').read_text(encoding='utf-8', errors='ignore')
text=re.sub(r'postgres(?:ql)?://[^\s\"\']+', 'postgresql://REDACTED', text)
idx=text.find('"schemaVersion"')
while idx>0 and text[idx]!='{': idx-=1
depth=0; end=None
for i,ch in enumerate(text[idx:], idx):
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0:
            end=i+1; break
data=json.loads(text[idx:end])
print('provider_ok='+str(data.get('ok')))
print('safety='+json.dumps(data.get('safety')))
PY
