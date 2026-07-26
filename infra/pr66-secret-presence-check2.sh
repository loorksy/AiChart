#!/usr/bin/env bash
# Presence-only secret/config check. Never prints secret values.
set -euo pipefail
cd /opt/aichart/web

echo "host=$(hostname)"
echo "prod_commit=$(git rev-parse HEAD)"
curl -fsS http://127.0.0.1:3010/api/healthz | python3 -c 'import sys,json;print("web_health="+json.load(sys.stdin).get("commit","?"))'

# Env file key presence
python3 - <<'PY'
from pathlib import Path
env = Path('/opt/aichart/web/.env').read_text(encoding='utf-8', errors='ignore')
keys = {}
for line in env.splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1)
        keys[k.strip()] = bool(v.strip())
for k in ['OPENAI_API_KEY','MCP_TEST_EMAIL','EA_PROBE_USER_ID','EA_PROBE_USER','DATABASE_URL','REDIS_URL']:
    print(f'env_{k}={"configured" if keys.get(k) else "missing"}')
PY

# Platform DB encrypted config presence via app helper (no value echo)
set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY|REDIS_URL)=' .env | sed 's/\r$//')
set +a
npx --yes tsx -e '
import { getPlatformValueAsync } from "./src/lib/platformConfig.ts";
const keys = ["OPENAI_API_KEY"];
for (const k of keys) {
  const v = await getPlatformValueAsync(k);
  const ok = Boolean(v && String(v).trim());
  console.log("platform_" + k + "=" + (ok ? "configured" : "missing"));
  console.log("platform_" + k + "_len=" + (ok ? String(String(v).trim().length) : "0"));
}
process.exit(0);
' 2>/dev/null || echo "platform_OPENAI_API_KEY=check_failed"

# MCP health ports
for p in 3100 3020 3030; do
  if curl -fsS "http://127.0.0.1:${p}/health" >/tmp/mcp_h.json 2>/dev/null; then
    python3 -c 'import json;d=json.load(open("/tmp/mcp_h.json"));print("mcp_port='"'"'$p'"'"'_commit="+str(d.get("commit") or d.get("gitCommit") or d.get("version") or "ok"))'
    break
  fi
done

# Isolated resources
docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel && echo isolated_redis=configured || echo isolated_redis=missing
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'" | grep -q 1 && echo isolated_pg=configured || echo isolated_pg=missing

# Root secret file names only
ls /root/aichart-secrets.env /root/.config/aichart/secrets.env 2>/dev/null | sed 's/.*/secret_file=&/' || echo secret_file=none
