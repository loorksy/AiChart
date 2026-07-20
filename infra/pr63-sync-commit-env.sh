#!/usr/bin/env bash
# Align VPS health/version endpoints with the deployed git commit.
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
DEPLOY_COMMIT="${DEPLOY_COMMIT:-f9dfa99108fffff1e4f1a6547f16769560e57499}"
WEB_ENV="$INSTALL_DIR/web/.env"

log() { echo "[sync-commit] $*"; }
die() { echo "[sync-commit] FATAL: $*" >&2; exit 1; }

[ -f "$WEB_ENV" ] || die "missing $WEB_ENV"
[ -f "$INSTALL_DIR/infra/pm2.ecosystem.config.cjs" ] || die "missing pm2 config"

log "Setting GIT_COMMIT=$DEPLOY_COMMIT in web/.env"
python3 - <<PY
from pathlib import Path
p = Path("$WEB_ENV")
lines = [l for l in p.read_text().splitlines() if not l.startswith("GIT_COMMIT=")]
lines.append("GIT_COMMIT=$DEPLOY_COMMIT")
p.write_text("\n".join(lines) + "\n")
PY

echo "$DEPLOY_COMMIT" >"$INSTALL_DIR/.deploy-commit"
log "Wrote $INSTALL_DIR/.deploy-commit"

cd "$INSTALL_DIR"
export GIT_COMMIT="$DEPLOY_COMMIT"
pm2 delete aichart-web aichart-worker aichart-mcp 2>/dev/null || true
GIT_COMMIT="$DEPLOY_COMMIT" pm2 start infra/pm2.ecosystem.config.cjs
pm2 save
sleep 8

log "health checks"
curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/pr63_commit_web.json
echo
curl -fsS http://127.0.0.1:8787/health | tee /tmp/pr63_commit_mcp.json
echo
python3 - <<PY
import json
w=json.load(open("/tmp/pr63_commit_web.json"))
m=json.load(open("/tmp/pr63_commit_mcp.json"))
exp="$DEPLOY_COMMIT".lower()
assert w.get("commit","").lower().startswith(exp[:7]), w
assert m.get("commit","").lower().startswith(exp[:7]), m
print("ok web="+w["commit"]+" mcp="+m["commit"])
PY

log "done"
