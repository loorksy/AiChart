#!/usr/bin/env bash
# Presence-only identity / MCP / dry-run probe. Never prints emails or secrets.
set -euo pipefail

echo "=== identity probe ==="
pm2 show aichart-mcp 2>/dev/null | grep -E 'script path|exec cwd|status|unstable|restarts' | head -20 || true
for p in 3100 3101 3020 3030 3200; do
  if curl -fsS "http://127.0.0.1:${p}/health" >/tmp/mcp_h.json 2>/dev/null; then
    python3 -c "import json;d=json.load(open('/tmp/mcp_h.json'));print('mcp_port',$p,'commit',str(d.get('commit') or d.get('gitCommit') or d)[:80])"
  fi
done

python3 - <<'PY'
import subprocess
from pathlib import Path
db=None
for line in Path('/opt/aichart/web/.env').read_text().splitlines():
  if line.startswith('DATABASE_URL='):
    db=line.split('=',1)[1].strip().strip('"').strip("'"); break
out=subprocess.check_output(['psql',db,'-At','-c','SELECT count(*) FROM users;'], text=True)
print('users_count='+out.strip())
out2=subprocess.check_output(
  ['psql',db,'-At','-c',
   "SELECT count(*) FROM users WHERE email ILIKE '%test%' OR email ILIKE '%e2e%' OR email ILIKE '%pr66%' OR email ILIKE '%release%' OR email ILIKE '%mcp%';"],
  text=True)
print('testish_user_count='+out2.strip())
text=Path('/opt/aichart/web/.env').read_text()
for k in ['AICHART_DISABLE_LIVE_ORDERS','DRY_RUN','BROKER_DRY_RUN','EXECUTION_DISABLED','MCP_TEST_EMAIL','EA_PROBE_USER_ID']:
  ok=any(l.startswith(k+'=') and l.split('=',1)[1].strip() for l in text.splitlines())
  print(f'{k}={"configured" if ok else "missing"}')
PY
