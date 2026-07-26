#!/usr/bin/env bash
set -euo pipefail
echo "=== setup log tail ==="
tail -n 80 /tmp/pr66-4a817d0-setup.log 2>/dev/null || echo no_log
echo "=== process ==="
ps aux | grep pr66-rc-4a817d0-setup | grep -v grep || echo no_setup_proc
echo "=== rc ==="
if [[ -d /opt/aichart-rc-pr66-4a817d0 ]]; then
  git -C /opt/aichart-rc-pr66-4a817d0 rev-parse HEAD 2>/dev/null || echo no_git
  if [[ -f /opt/aichart-rc-pr66-4a817d0/web/.env ]]; then
    python3 - <<'PY'
from pathlib import Path
t=Path('/opt/aichart-rc-pr66-4a817d0/web/.env').read_text()
print('rc_env_exists=1')
for k in ['OPENAI_API_KEY','DATABASE_URL','REDIS_URL','AICHART_DISABLE_LIVE_ORDERS']:
  ok=any(l.startswith(k+'=') and l.split('=',1)[1].strip() for l in t.splitlines())
  print(f'rc_env_{k}={"configured" if ok else "missing"}')
PY
  else
    echo rc_env_missing
  fi
  test -d /opt/aichart-rc-pr66-4a817d0/web/public/tradingview && echo TV=present || echo TV=missing
else
  echo rc_dir_missing
fi
grep -E 'SETUP DONE|FAIL |OPENAI_INJECT' /tmp/pr66-4a817d0-setup.log 2>/dev/null || true
