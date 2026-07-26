#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart/web || exit 1
set -a
# shellcheck disable=SC1091
source .env
set +a

echo "host=$(hostname)"
echo "prod_commit=$(git -C /opt/aichart rev-parse HEAD 2>/dev/null || echo unknown)"
echo "web_health=$(curl -fsS http://127.0.0.1:3010/api/healthz 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("commit","?")[:40])' 2>/dev/null || echo unavailable)"
echo "mcp_health=$(curl -fsS http://127.0.0.1:3101/health 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("commit") or d.get("gitCommit") or "?" )[:40])' 2>/dev/null || echo unavailable)"

presence() {
  local name="$1" val="${2:-}"
  if [[ -n "${val}" ]]; then echo "${name}=configured"; else echo "${name}=missing"; fi
}

presence "env_OPENAI_API_KEY" "${OPENAI_API_KEY:-}"
presence "env_MCP_TEST_EMAIL" "${MCP_TEST_EMAIL:-}"
presence "env_EA_PROBE_USER_ID" "${EA_PROBE_USER_ID:-}"
presence "env_EA_PROBE_USER" "${EA_PROBE_USER:-}"
presence "env_DATABASE_URL" "${DATABASE_URL:-}"
presence "env_REDIS_URL" "${REDIS_URL:-}"

# Platform config via app helper (no value printed)
node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  try {
    const rows = await p.$queryRawUnsafe(
      "SELECT key, CASE WHEN value IS NULL OR btrim(value::text) = '' THEN 0 ELSE 1 END AS present, plain FROM platform_config WHERE key = $1",
      "OPENAI_API_KEY"
    );
    if (!rows.length) {
      console.log("platform_OPENAI_API_KEY=missing");
    } else {
      console.log(rows[0].present === 1 || rows[0].present === true ? "platform_OPENAI_API_KEY=configured" : "platform_OPENAI_API_KEY=missing");
      console.log("platform_OPENAI_plain=" + String(rows[0].plain));
    }
  } catch (e) {
    console.log("platform_OPENAI_API_KEY=check_failed");
    console.log("platform_OPENAI_error=" + String(e && e.message ? e.message : e).slice(0, 200));
  } finally {
    await p.$disconnect();
  }
})();
NODE

# Also check via encrypted get if helper exists in built dist — skip values
if [[ -f /opt/aichart/web/node_modules/.bin/tsx ]]; then
  cd /opt/aichart/web
  npx --yes tsx -e '
import { getPlatformValueAsync } from "./src/lib/platformConfig.ts";
const v = await getPlatformValueAsync("OPENAI_API_KEY");
console.log(v && String(v).trim() ? "platform_helper_OPENAI=configured" : "platform_helper_OPENAI=missing");
' 2>/tmp/pr66-platform-helper.err && true || {
  echo "platform_helper_OPENAI=check_failed"
  echo "platform_helper_error=$(head -c 200 /tmp/pr66-platform-helper.err | tr '\n' ' ')"
}
fi

# Isolated resources
if docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel; then
  echo "isolated_redis=configured"
else
  echo "isolated_redis=missing"
fi
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'" 2>/dev/null | grep -q 1; then
  echo "isolated_pg=configured"
else
  echo "isolated_pg=missing"
fi

# Look for approved secret files (presence only)
for f in /etc/aichart/release-test.env /root/.config/aichart/release-test.env /opt/aichart-secrets/release-test.env; do
  if [[ -f "$f" ]]; then
    echo "secret_file=present:$f"
    # presence of keys only
    for k in OPENAI_API_KEY MCP_TEST_EMAIL EA_PROBE_USER_ID EA_PROBE_USER DATABASE_URL REDIS_URL; do
      if grep -qE "^${k}=" "$f"; then
        val=$(grep -E "^${k}=" "$f" | head -1 | cut -d= -f2-)
        if [[ -n "$val" ]]; then echo "file_${k}=configured"; else echo "file_${k}=empty"; fi
      else
        echo "file_${k}=missing"
      fi
    done
    exit 0
  fi
done
echo "secret_file=none"
