#!/usr/bin/env bash
set -uo pipefail
python3 - <<'PY'
from pathlib import Path
p = Path("/tmp/prov-a0a09a8.out")
print("exists", p.exists(), "size", p.stat().st_size if p.exists() else None)
if p.exists():
    t = p.read_text(errors="ignore")
    print("has_schema", '"schemaVersion"' in t)
    print("---TAIL---")
    print(t[-1500:])
PY
if [[ -f /tmp/prov-a0a09a8.out ]] && grep -q '"schemaVersion"' /tmp/prov-a0a09a8.out; then
  echo KILLING_HUNG_PROVIDER
  pkill -f 'validate-provider-release' || true
fi
sleep 2
ps -p 2893488 -o pid,etime,cmd 2>/dev/null || echo QUALIFIER_DONE
echo '---SUMMARY---'
cat /tmp/pr66-a0a09a8-qualify-summary.txt 2>/dev/null || true
echo '---LOGTAIL---'
tail -n 40 /tmp/pr66-a0a09a8-qualify.log 2>/dev/null || true
ps aux | grep -E 'playwright|test:tools|test:create|test:pr66|next start -p 3019|mcp' | grep -v grep | head -20
