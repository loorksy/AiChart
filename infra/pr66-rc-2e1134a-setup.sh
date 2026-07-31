#!/usr/bin/env bash
# Fresh isolated RC for PR66 head 2e1134a. Never mutates production.
set -euo pipefail
RC_SHA=2e1134aba42136af3e2a810dec5ca09175414529
RC_DIR=/opt/aichart-rc-pr66-2e1134a
PROD=/opt/aichart
REPO=https://github.com/loorksy/AiChart.git
LOG=/tmp/pr66-2e1134a-setup.log
: >"$LOG"
exec > >(tee -a "$LOG") 2>&1
echo "=== RC SETUP $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

if [[ -d "$RC_DIR" ]]; then
  echo "Removing existing $RC_DIR"
  rm -rf "$RC_DIR"
fi

git clone --no-checkout "$REPO" "$RC_DIR"
cd "$RC_DIR"
git fetch --all --prune
git checkout --force "$RC_SHA"
git reset --hard "$RC_SHA"
git clean -fdx
test "$(git rev-parse HEAD)" = "$RC_SHA"
test -z "$(git status --porcelain)"
echo "CHECKED_OUT=$(git rev-parse HEAD)"
git diff --check
echo "DIFF_CHECK_OK"

if git ls-files | grep -q '^\.cursor/'; then echo "FAIL tracked .cursor"; exit 2; fi
echo "NO_TRACKED_CURSOR"
BAD_ENV=$(git ls-files | grep -E '(^|/)\.env$' || true)
if [[ -n "$BAD_ENV" ]]; then echo "FAIL tracked env"; echo "$BAD_ENV"; exit 2; fi
echo "NO_TRACKED_ENV"

if [[ -d "$PROD/web/public/charting_library" ]]; then
  mkdir -p "$RC_DIR/web/public/charting_library"
  rsync -a --delete "$PROD/web/public/charting_library/" "$RC_DIR/web/public/charting_library/"
  echo "TV_PUBLIC_OK"
else
  echo "FAIL charting_library missing"; exit 2
fi
if [[ -d "$PROD/web/src/vendor/tradingview" ]]; then
  mkdir -p "$RC_DIR/web/src/vendor/tradingview"
  rsync -a --delete "$PROD/web/src/vendor/tradingview/" "$RC_DIR/web/src/vendor/tradingview/"
  echo "TV_VENDOR_OK"
else
  echo "FAIL vendor tradingview missing"; exit 2
fi

if ! docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel; then
  docker rm -f aichart-redis-rel >/dev/null 2>&1 || true
  REDIS_PASS=$(openssl rand -hex 16)
  echo "$REDIS_PASS" > /root/aichart-rc-redis-rel.pass
  chmod 600 /root/aichart-rc-redis-rel.pass
  docker run -d --name aichart-redis-rel --restart unless-stopped \
    -p 127.0.0.1:6380:6379 \
    redis:7-alpine redis-server \
    --requirepass "$REDIS_PASS" \
    --appendonly yes --appendfsync everysec --maxmemory-policy noeviction
  sleep 2
fi
REDIS_PASS=$(cat /root/aichart-rc-redis-rel.pass)
docker exec aichart-redis-rel redis-cli -a "$REDIS_PASS" ping

sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='aichart_rel_pr66' AND pid <> pg_backend_pid();" >/dev/null || true
sudo -u postgres dropdb --if-exists aichart_rel_pr66
sudo -u postgres createdb aichart_rel_pr66
sudo -u postgres psql -d aichart_rel_pr66 -c 'CREATE EXTENSION IF NOT EXISTS vector;'

python3 - <<'PY'
from pathlib import Path
import urllib.parse
prod = Path("/opt/aichart/web/.env").read_text()
db = [l.split("=", 1)[1].strip() for l in prod.splitlines() if l.startswith("DATABASE_URL=")][0]
u = urllib.parse.urlparse(db)
user = u.username or "postgres"
Path("/tmp/rc_db_user").write_text(user)
parts = list(u)
parts[2] = "/aichart_rel_pr66"
Path("/tmp/rc_db_url").write_text(urllib.parse.urlunparse(parts))
print("REL_DB_URL_READY user=" + user)
PY
DB_USER=$(cat /tmp/rc_db_user)
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE aichart_rel_pr66 TO \"$DB_USER\";"
sudo -u postgres psql -d aichart_rel_pr66 -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
sudo -u postgres psql -d aichart_rel_pr66 -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";"

# Build RC env from prod + isolated overrides + release-test secrets (presence merge)
python3 - <<'PY'
from pathlib import Path
rel_db = Path("/tmp/rc_db_url").read_text().strip()
redis_pass = Path("/root/aichart-rc-redis-rel.pass").read_text().strip()
rel_redis = f"redis://:{redis_pass}@127.0.0.1:6380/0"
sha = "2e1134aba42136af3e2a810dec5ca09175414529"
prod = Path("/opt/aichart/web/.env").read_text(encoding="utf-8", errors="ignore")
lines=[]
for line in prod.splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append("DATABASE_URL="+rel_db)
    elif line.startswith("REDIS_URL="):
        lines.append("REDIS_URL="+rel_redis)
    elif line.startswith("OPENAI_API_KEY=") or line.startswith("GIT_COMMIT=") or line.startswith("PORT="):
        continue
    else:
        lines.append(line)
# merge release-test keys
secret=Path("/root/.config/aichart/release-test.env")
if secret.is_file():
    for line in secret.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip() or line.strip().startswith("#") or "=" not in line:
            continue
        k=line.split("=",1)[0]
        lines=[l for l in lines if not l.startswith(k+"=")]
        lines.append(line)
for k,v in [
    ("GIT_COMMIT", sha),
    ("PORT", "3019"),
    ("AICHART_DISABLE_LIVE_ORDERS", "1"),
    ("FEATURE_AGENT_EXECUTION_GUARD", "1"),
    ("NODE_ENV", "production"),
]:
    lines=[l for l in lines if not l.startswith(k+"=")]
    lines.append(f"{k}={v}")
env_path=Path("/opt/aichart-rc-pr66-2e1134a/web/.env")
env_path.write_text("\n".join(lines)+"\n", encoding="utf-8")
env_path.chmod(0o600)
print("RC_ENV_WRITTEN")
PY

# Inject OpenAI from platform_config without printing value
INJECT_DIR=""
if [[ -d /opt/aichart-rc-pr66-4a817d0/web/node_modules ]]; then
  INJECT_DIR=/opt/aichart-rc-pr66-4a817d0/web
elif [[ -d /opt/aichart-rc-pr66-2a06170/web/node_modules ]]; then
  INJECT_DIR=/opt/aichart-rc-pr66-2a06170/web
fi
if [[ -n "$INJECT_DIR" ]]; then
  (
    cd "$INJECT_DIR"
    set -a
    # shellcheck disable=SC1091
    source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY)=' /opt/aichart/web/.env | sed 's/\r$//')
    set +a
    npx --yes tsx -e '
import { getPlatformValueAsync } from "./src/lib/platformConfig.ts";
import fs from "fs";
(async () => {
  const v = (await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
  if (!v) { console.log("OPENAI_INJECT=missing"); process.exit(2); }
  const envPath = "/opt/aichart-rc-pr66-2e1134a/web/.env";
  let lines = fs.readFileSync(envPath,"utf8").split(/\r?\n/).filter(l => !l.startsWith("OPENAI_API_KEY="));
  while (lines.length && lines[lines.length-1]==="") lines.pop();
  lines.push("OPENAI_API_KEY="+v);
  fs.writeFileSync(envPath, lines.join("\n")+"\n", {mode:0o600});
  console.log("OPENAI_INJECT=configured");
  console.log("OPENAI_INJECT_LEN="+String(v.length));
})().catch(e => { console.log("OPENAI_INJECT=failed"); process.exit(1); });
'
  ) || echo "OPENAI_INJECT=failed"
else
  echo "OPENAI_INJECT=skipped_no_node_modules"
fi

python3 - <<'PY'
from pathlib import Path
t=Path('/opt/aichart-rc-pr66-2e1134a/web/.env').read_text()
for k in ['OPENAI_API_KEY','DATABASE_URL','REDIS_URL','MCP_TEST_EMAIL','WEB_TEST_EMAIL','PROVIDER_RELEASE_EA_USER_ID','AICHART_DISABLE_LIVE_ORDERS','GIT_COMMIT']:
  ok=any(l.startswith(k+'=') and l.split('=',1)[1].strip() for l in t.splitlines())
  print(f'rc_env_{k}={"configured" if ok else "missing"}')
PY

if [[ -f "$PROD/mcp/.env" ]]; then
  cp -a "$PROD/mcp/.env" "$RC_DIR/mcp/.env"
  chmod 600 "$RC_DIR/mcp/.env"
  # merge MCP_TEST_* into mcp env without printing
  python3 - <<'PY'
from pathlib import Path
secret=Path("/root/.config/aichart/release-test.env")
mcp=Path("/opt/aichart-rc-pr66-2e1134a/mcp/.env")
lines=mcp.read_text(encoding="utf-8", errors="ignore").splitlines() if mcp.exists() else []
if secret.exists():
  for line in secret.read_text(encoding="utf-8", errors="ignore").splitlines():
    if line.startswith("MCP_TEST_") or line.startswith("WEB_TEST_"):
      k=line.split("=",1)[0]
      lines=[l for l in lines if not l.startswith(k+"=")]
      lines.append(line)
mcp.write_text("\n".join(lines)+"\n", encoding="utf-8")
mcp.chmod(0o600)
print("MCP_ENV_MERGED")
PY
fi

echo "=== SETUP DONE ==="
