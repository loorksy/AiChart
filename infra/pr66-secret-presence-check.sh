#!/usr/bin/env bash
# Report presence only — never print secret values.
set -euo pipefail
check_key() {
  local file="$1" key="$2"
  if [ -f "$file" ] && grep -qE "^${key}=.+" "$file"; then
    local val
    val=$(grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '\r')
    if [ -n "$val" ] && [ "$val" != "changeme" ] && [ "$val" != "REPLACE_ME" ]; then
      echo "${key}=configured"
      return 0
    fi
  fi
  echo "${key}=missing"
  return 1
}

echo "host=$(hostname)"
echo "prod_web_commit=$(git -C /opt/aichart rev-parse HEAD 2>/dev/null || echo unknown)"
curl -fsS http://127.0.0.1:3010/api/healthz 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print("prod_health_commit="+d.get("commit","?"))' || echo "prod_health_commit=unreachable"
curl -fsS http://127.0.0.1:3100/health 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print("mcp_health_commit="+str(d.get("commit") or d.get("gitCommit") or "?"))' || \
  curl -fsS http://127.0.0.1:3020/health 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print("mcp_health_commit="+str(d.get("commit") or "?"))' || echo "mcp_health_commit=unreachable"

ENVF=/opt/aichart/web/.env
MCPF=/opt/aichart/mcp/.env
FAIL=0
for key in OPENAI_API_KEY MCP_TEST_EMAIL EA_PROBE_USER_ID EA_PROBE_USER; do
  if ! check_key "$ENVF" "$key"; then
    # also check mcp env / root secret files
    if [ -f "$MCPF" ] && grep -qE "^${key}=.+" "$MCPF"; then
      echo "${key}=configured(mcp.env)"
    elif [ -f "/root/aichart-secrets.env" ] && grep -qE "^${key}=.+" "/root/aichart-secrets.env"; then
      echo "${key}=configured(root-secrets)"
    else
      FAIL=1
    fi
  fi
done

# PM2 env presence (names only)
pm2 jlist 2>/dev/null | python3 - <<'PY'
import json,sys
try:
  data=json.load(sys.stdin)
except Exception:
  print("pm2_openai=unknown")
  raise SystemExit(0)
found=False
for p in data:
  if p.get("name") not in ("aichart-web","aichart-mcp","aichart-worker"):
    continue
  env=p.get("pm2_env",{}).get("env",{})
  for k in ("OPENAI_API_KEY","MCP_TEST_EMAIL","EA_PROBE_USER_ID"):
    v=env.get(k)
    print(f"pm2_{p.get('name')}_{k}={'configured' if v else 'missing'}")
    if k=="OPENAI_API_KEY" and v:
      found=True
print("pm2_openai_any="+("configured" if found else "missing"))
PY

# Isolated resources from prior RC
echo "isolated_redis_6380=$(docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel && echo configured || echo missing)"
echo "isolated_pg=$(sudo -u postgres psql -tc \"SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'\" 2>/dev/null | grep -q 1 && echo configured || echo missing)"

exit "$FAIL"
