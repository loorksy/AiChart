#!/usr/bin/env bash
# Clean isolated RC for PR66 head 4a817d0. Never mutates production.
set -euo pipefail
RC_SHA=4a817d082208eb4fdc6e3f238d5940979b6be5e1
RC_DIR=/opt/aichart-rc-pr66-4a817d0
PROD=/opt/aichart
REPO=https://github.com/loorksy/AiChart.git
LOG=/tmp/pr66-4a817d0-setup.log
: >"$LOG"

exec > >(tee -a "$LOG") 2>&1
echo "=== RC SETUP $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Clean previous dirty RC for this SHA if present
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

# Ensure .cursor not tracked
if git ls-files | grep -q '^\.cursor/'; then
  echo "FAIL tracked .cursor"; exit 2
fi
echo "NO_TRACKED_CURSOR"

# No real environment/secret files tracked (.env.example allowed)
BAD_ENV=$(git ls-files | grep -E '(^|/)\.env$' || true)
BAD_SECRET=$(git ls-files | grep -Ei '(^|/)secrets?\.(env|json|ya?ml)$|(^|/)credentials\.(json|env)$|(^|/)serviceAccount.*\.json$' || true)
if [[ -n "$BAD_ENV$BAD_SECRET" ]]; then
  echo "FAIL unexpected tracked env/secret"
  echo "$BAD_ENV"
  echo "$BAD_SECRET"
  exit 2
fi
echo "NO_TRACKED_ENV_OR_SECRET"
# Temp RC artifacts must not be in the tree
if git ls-files | grep -E 'pr66-.*\.(log|nohup|tmp)$|/tmp/|aichart-rc-' ; then
  echo "FAIL unexpected temp RC artifacts tracked"; exit 2
else
  echo "NO_TRACKED_TEMP_RC_ARTIFACTS"
fi

# Provision licensed TradingView / charting_library from production (not from git)
if [[ -d "$PROD/web/public/charting_library" ]]; then
  mkdir -p "$RC_DIR/web/public/charting_library"
  rsync -a --delete "$PROD/web/public/charting_library/" "$RC_DIR/web/public/charting_library/"
  echo "TV_PUBLIC_CHARTING_LIBRARY_PROVISIONED"
else
  echo "FAIL public/charting_library missing in prod"; exit 2
fi
if [[ -d "$PROD/web/src/vendor/tradingview" ]]; then
  mkdir -p "$RC_DIR/web/src/vendor/tradingview"
  rsync -a --delete "$PROD/web/src/vendor/tradingview/" "$RC_DIR/web/src/vendor/tradingview/"
  echo "TV_VENDOR_PROVISIONED"
else
  echo "FAIL src/vendor/tradingview missing in prod"; exit 2
fi

# Isolated Redis (reuse if healthy)
if ! docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel; then
  docker rm -f aichart-redis-rel >/dev/null 2>&1 || true
  REDIS_PASS=$(openssl rand -hex 16)
  echo "$REDIS_PASS" > /root/aichart-rc-redis-rel.pass
  chmod 600 /root/aichart-rc-redis-rel.pass
  docker run -d --name aichart-redis-rel --restart unless-stopped \
    -p 127.0.0.1:6380:6379 \
    redis:7-alpine redis-server \
    --requirepass "$REDIS_PASS" \
    --appendonly yes \
    --appendfsync everysec \
    --maxmemory-policy noeviction
  sleep 2
fi
REDIS_PASS=$(cat /root/aichart-rc-redis-rel.pass)
docker exec aichart-redis-rel redis-cli -a "$REDIS_PASS" ping

# Isolated PG
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'" | grep -q 1 \
  || sudo -u postgres createdb aichart_rel_pr66
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
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE aichart_rel_pr66 TO \"$DB_USER\";" || true
sudo -u postgres psql -d aichart_rel_pr66 -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";" || true
sudo -u postgres psql -d aichart_rel_pr66 -c "ALTER SCHEMA public OWNER TO \"$DB_USER\";" || true

# Build RC .env from prod (no commit), override DB/Redis, inject OpenAI from platform via helper later
python3 - <<'PY'
from pathlib import Path
import re
prod = Path("/opt/aichart/web/.env").read_text(encoding="utf-8", errors="ignore")
lines = []
for line in prod.splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append("DATABASE_URL=" + Path("/tmp/rc_db_url").read_text().strip())
    elif line.startswith("REDIS_URL="):
        pass_ = Path("/root/aichart-rc-redis-rel.pass").read_text().strip()
        lines.append(f"REDIS_URL=redis://:{pass_}@127.0.0.1:6380/0")
    elif line.startswith("OPENAI_API_KEY="):
        continue  # inject separately from platform
    else:
        lines.append(line)
lines.append("AICHART_DISABLE_LIVE_ORDERS=1")
lines.append("NODE_ENV=production")
Path("/opt/aichart-rc-pr66-4a817d0/web/.env").write_text("\n".join(lines) + "\n", encoding="utf-8")
Path("/opt/aichart-rc-pr66-4a817d0/web/.env").chmod(0o600)
print("RC_ENV_WRITTEN")
PY

# Inject OPENAI from production platform_config without printing value
cd /opt/aichart/web
set -a
# shellcheck disable=SC1091
source <(grep -E '^(DATABASE_URL|ENCRYPTION_KEY)=' .env | sed 's/\r$//')
set +a
# Use node + pg from a path that has deps - prefer previous RC if present
INJECT_DIR=""
if [[ -d /opt/aichart-rc-pr66-2a06170/web/node_modules ]]; then
  INJECT_DIR=/opt/aichart-rc-pr66-2a06170/web
elif [[ -d /opt/aichart/web/node_modules/@prisma/client ]]; then
  INJECT_DIR=/opt/aichart/web
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
const v = (await getPlatformValueAsync("OPENAI_API_KEY"))?.trim();
if (!v) { console.log("OPENAI_INJECT=missing"); process.exit(2); }
const envPath = "/opt/aichart-rc-pr66-4a817d0/web/.env";
let text = fs.readFileSync(envPath, "utf8");
text = text.replace(/^OPENAI_API_KEY=.*$/m, "");
if (!text.endsWith("\n")) text += "\n";
text += "OPENAI_API_KEY=" + v + "\n";
fs.writeFileSync(envPath, text, { mode: 0o600 });
console.log("OPENAI_INJECT=configured");
console.log("OPENAI_INJECT_LEN=" + String(v.length));
' 
  ) || echo "OPENAI_INJECT=failed"
else
  echo "OPENAI_INJECT=skipped_no_node_modules"
fi

# Presence check RC env (no values)
python3 - <<'PY'
from pathlib import Path
text=Path('/opt/aichart-rc-pr66-4a817d0/web/.env').read_text()
keys={}
for line in text.splitlines():
  if '=' in line and not line.strip().startswith('#'):
    k,v=line.split('=',1); keys[k]=bool(v.strip())
for k in ['OPENAI_API_KEY','DATABASE_URL','REDIS_URL','AICHART_DISABLE_LIVE_ORDERS','ENCRYPTION_KEY']:
  print(f'rc_env_{k}={"configured" if keys.get(k) else "missing"}')
PY

echo "=== SETUP DONE ==="
