#!/usr/bin/env bash
set -euo pipefail
echo "== pm2 processes =="
pm2 jlist | python3 -c 'import json,sys; data=json.load(sys.stdin);
for p in data:
  env=p.get("pm2_env",{}).get("env",{})
  keys=sorted(k for k in env if any(x in k.upper() for x in ("OPENAI","OANDA","MCP_TEST","EA_PROBE","API_KEY")))
  print(p.get("name"), keys)'
echo "== env files key names =="
for f in /opt/aichart/web/.env /opt/aichart-rc-pr66-2a06170/web/.env; do
  echo "FILE=$f"
  grep -E '^[A-Z0-9_]+=' "$f" | cut -d= -f1 | grep -Ei 'OPENAI|OANDA|MCP_TEST|EA_PROBE|API_KEY|LLM' || true
done
echo "== systemd/unit hints =="
systemctl cat aichart-web 2>/dev/null | grep -E 'Environment|OPENAI' | sed 's/=.*/=***/' || true
