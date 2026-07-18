#!/usr/bin/env bash
# Isolated PR #66 release-candidate setup on VPS. Never touches production DB/Redis.
set -euo pipefail
RC_SHA=2a06170be0e4870d664adabfc12205221433c08c
RC_DIR=/opt/aichart-rc-pr66-2a06170
PROD=/opt/aichart
LOG=/tmp/pr66-rc-qualify.log

echo "=== SETUP2 $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG"
cd "$RC_DIR"
test "$(git rev-parse HEAD)" = "$RC_SHA"
test -z "$(git status --porcelain)"

python3 - <<'PY'
from pathlib import Path
banned = [
  "buildTradeCandidates",
  "selectedTradeCandidateId",
  "MODEL_FIRST_MODE",
  "runRiskAgent",
  "runFinalDecisionSynthesizer",
]
hits = []
for root_name in ("web/src", "mcp/src"):
  root = Path(root_name)
  if not root.exists():
    continue
  for p in root.rglob("*"):
    if p.suffix not in {".ts", ".tsx", ".js", ".mjs"}:
      continue
    if "__tests__" in p.parts or ".test." in p.name:
      continue
    text = p.read_text(encoding="utf-8", errors="ignore")
    for b in banned:
      if b in text:
        hits.append(f"{p}:{b}")
    if "type TradeCandidate" in text or "interface TradeCandidate" in text:
      hits.append(f"{p}:TradeCandidate type")
if hits:
  print("ARCH_FAIL")
  print("\n".join(hits[:50]))
  raise SystemExit(2)
print("ARCH_SCAN_OK")
PY

if ! docker ps --format '{{.Names}}' | grep -qx aichart-redis-rel; then
  docker rm -f aichart-redis-rel >/dev/null 2>&1 || true
  REDIS_PASS=$(openssl rand -hex 16)
  echo "$REDIS_PASS" > /root/aichart-rc-redis-rel.pass
  chmod 600 /root/aichart-rc-redis-rel.pass
  docker run -d --name aichart-redis-rel --restart unless-stopped \
    -p 127.0.0.1:6380:6379 \
    redis:7-alpine redis-server --requirepass "$REDIS_PASS" --save "" --appendonly no
  sleep 2
fi
REDIS_PASS=$(cat /root/aichart-rc-redis-rel.pass)
docker exec aichart-redis-rel redis-cli -a "$REDIS_PASS" ping

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='aichart_rel_pr66'" | grep -q 1 \
  || sudo -u postgres createdb aichart_rel_pr66

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

cp -a "$PROD/web/.env" "$RC_DIR/web/.env"
chmod 600 "$RC_DIR/web/.env"
python3 - <<'PY'
from pathlib import Path
rel_db = Path("/tmp/rc_db_url").read_text().strip()
redis_pass = Path("/root/aichart-rc-redis-rel.pass").read_text().strip()
rel_redis = f"redis://:{redis_pass}@127.0.0.1:6380/0"
rc_sha = "2a06170be0e4870d664adabfc12205221433c08c"
env_path = Path("/opt/aichart-rc-pr66-2a06170/web/.env")
lines = []
for line in env_path.read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append("DATABASE_URL=" + rel_db)
    elif line.startswith("REDIS_URL="):
        lines.append("REDIS_URL=" + rel_redis)
    elif line.startswith("GIT_COMMIT="):
        lines.append("GIT_COMMIT=" + rc_sha)
    elif line.startswith("PORT="):
        lines.append("PORT=3019")
    else:
        lines.append(line)
for k, v in [
    ("GIT_COMMIT", rc_sha),
    ("FEATURE_AGENT_EXECUTION_GUARD", "1"),
    ("AICHART_DISABLE_LIVE_ORDERS", "1"),
]:
    if not any(l.startswith(k + "=") for l in lines):
        lines.append(f"{k}={v}")
env_path.write_text("\n".join(lines) + "\n")
print("RC_ENV_OK")
PY

if [ -f "$PROD/mcp/.env" ]; then
  cp -a "$PROD/mcp/.env" "$RC_DIR/mcp/.env"
  chmod 600 "$RC_DIR/mcp/.env"
fi

cat > /root/aichart-rc-pr66.env <<EOF
RC_SHA=$RC_SHA
RC_DIR=$RC_DIR
EOF
chmod 600 /root/aichart-rc-pr66.env
echo "SETUP2_OK" | tee -a "$LOG"
