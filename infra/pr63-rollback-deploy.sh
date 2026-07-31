#!/usr/bin/env bash
# Rollback production to PR #63 merge commit on VPS.
set -euo pipefail
DEPLOY_COMMIT="${DEPLOY_COMMIT:-ed8d529ed45fe32dcab27b0a5b5e853959f53f9f}"
PREVIOUS_COMMIT="${PREVIOUS_COMMIT:-522e372866d606cafe8ceb40ff2615d68d2807e0}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
REPO_URL="${REPO_URL:-https://github.com/loorksy/AiChart.git}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/aichart-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/pr63-rollback-$STAMP"
NEW_DIR="/opt/aichart-pr63-$STAMP"
LOG=/tmp/pr63-rollback-deploy.log
SUM=/tmp/pr63-rollback-deploy-summary.txt
: >"$LOG"
: >"$SUM"
exec > >(tee -a "$LOG") 2>&1

echo "=== PR63 ROLLBACK DEPLOY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "target=$DEPLOY_COMMIT"
echo "previous=$PREVIOUS_COMMIT"

curl -fsS http://127.0.0.1:3010/api/healthz | tee /tmp/pr63_before_web.json
curl -fsS http://127.0.0.1:8787/health | tee /tmp/pr63_before_mcp.json
echo
python3 - <<PY
import json
w=json.load(open('/tmp/pr63_before_web.json'))
m=json.load(open('/tmp/pr63_before_mcp.json'))
print('before_web='+w.get('commit',''))
print('before_mcp='+m.get('commit',''))
PY

# Use canonical clean-redeploy with explicit commit checkout
export REPO_URL INSTALL_DIR BACKUP_ROOT
export NEW_DIR BACKUP_DIR

# Patch clone step: fetch exact commit instead of main tip
bash - <<'INNER'
set -euo pipefail
source /dev/null
DEPLOY_COMMIT="${DEPLOY_COMMIT:-ed8d529ed45fe32dcab27b0a5b5e853959f53f9f}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
REPO_URL="${REPO_URL:-https://github.com/loorksy/AiChart.git}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/aichart-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_DIR:-$BACKUP_ROOT/pr63-rollback-$STAMP}"
NEW_DIR="${NEW_DIR:-/opt/aichart-pr63-$STAMP}"
PORT_DEFAULT=3010
TRADINGVIEW_PUBLIC_REL="web/public/charting_library"
TRADINGVIEW_VENDOR_REL="web/src/vendor/tradingview"
TRADINGVIEW_BACKUP_DIR="$BACKUP_DIR/licensed-tradingview"

log() { echo "[pr63-rollback] $*"; }
die() { echo "[pr63-rollback] FATAL: $*" >&2; exit 1; }

verify_nonempty_asset_dir() {
  local dir="$1" label="$2"
  [ -d "$dir" ] || die "$label is missing."
  [ ! -L "$dir" ] || die "$label must be a real directory, not a symlink."
  local first_file
  first_file="$(find "$dir" -type f -size +0c -print -quit 2>/dev/null || true)"
  [ -n "$first_file" ] || die "$label contains no non-empty files."
}

verify_tradingview_assets() {
  local root="$1" context="$2"
  verify_nonempty_asset_dir "$root/$TRADINGVIEW_PUBLIC_REL" "$context TradingView runtime directory"
  verify_nonempty_asset_dir "$root/$TRADINGVIEW_VENDOR_REL" "$context TradingView typings directory"
  [ -s "$root/$TRADINGVIEW_PUBLIC_REL/charting_library.standalone.js" ] ||
    die "$context TradingView runtime bundle is missing or empty."
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"
umask 077

log "Inventory + backup"
{
  echo "== rollback target =="; echo "$DEPLOY_COMMIT"
  echo "== pm2 =="; pm2 ls 2>/dev/null || true
} >"$BACKUP_DIR/inventory.txt"

for f in "$INSTALL_DIR/web/.env" "$INSTALL_DIR/mcp/.env" "$INSTALL_DIR/research-service/.env"; do
  [ -f "$f" ] && cp -a "$f" "$BACKUP_DIR/$(echo "$f" | tr '/' '_')"
done
pm2 save 2>/dev/null || true
[ -f /root/.pm2/dump.pm2 ] && cp -a /root/.pm2/dump.pm2 "$BACKUP_DIR/dump.pm2" || true

verify_tradingview_assets "$INSTALL_DIR" "Installed"
mkdir -p "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL" "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL"
cp -a -- "$INSTALL_DIR/$TRADINGVIEW_PUBLIC_REL/." "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL/"
cp -a -- "$INSTALL_DIR/$TRADINGVIEW_VENDOR_REL/." "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL/"

DATABASE_URL="$(grep '^DATABASE_URL=' "$INSTALL_DIR/web/.env" 2>/dev/null | cut -d= -f2- || true)"
if [ -n "$DATABASE_URL" ]; then
  pg_dump --format=custom --dbname="$DATABASE_URL" --file="$BACKUP_DIR/aichart.pgdump"
  pg_restore --list "$BACKUP_DIR/aichart.pgdump" >/dev/null
fi

log "Stopping AiChart PM2 apps"
for app in aichart-web aichart-worker aichart-mcp aichart-agent; do
  pm2 delete "$app" 2>/dev/null || true
done
pm2 save --force 2>/dev/null || true

log "Fresh clone + checkout PR63 merge commit"
rm -rf "$NEW_DIR"
git clone "$REPO_URL" "$NEW_DIR"
git -C "$NEW_DIR" checkout --force "$DEPLOY_COMMIT"
CHECKED="$(git -C "$NEW_DIR" rev-parse HEAD)"
[ "$CHECKED" = "$DEPLOY_COMMIT" ] || die "checkout mismatch: $CHECKED"

log "Restoring env + TradingView"
for f in web mcp research-service; do
  src="$BACKUP_DIR/$(echo "$INSTALL_DIR/$f/.env" | tr '/' '_')"
  [ -f "$src" ] && install -m 600 "$src" "$NEW_DIR/$f/.env" || true
done
grep -q '^GIT_COMMIT=' "$NEW_DIR/web/.env" 2>/dev/null || echo "GIT_COMMIT=$DEPLOY_COMMIT" >>"$NEW_DIR/web/.env"
sed -i "s/^GIT_COMMIT=.*/GIT_COMMIT=$DEPLOY_COMMIT/" "$NEW_DIR/web/.env"

mkdir -p "$NEW_DIR/$TRADINGVIEW_PUBLIC_REL" "$NEW_DIR/$TRADINGVIEW_VENDOR_REL"
cp -a -- "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL/." "$NEW_DIR/$TRADINGVIEW_PUBLIC_REL/"
cp -a -- "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL/." "$NEW_DIR/$TRADINGVIEW_VENDOR_REL/"
verify_tradingview_assets "$NEW_DIR" "Restored"

log "Building web + mcp"
cd "$NEW_DIR/web" && npm ci && npm run build
cd "$NEW_DIR/mcp" && npm ci && npm run build

OLD_TARGET=""
if [ -L "$INSTALL_DIR" ]; then
  OLD_TARGET="$(readlink -f "$INSTALL_DIR")"
  ln -sfn "$NEW_DIR" "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ]; then
  OLD_TARGET="${INSTALL_DIR}-old-$STAMP"
  mv "$INSTALL_DIR" "$OLD_TARGET"
  ln -s "$NEW_DIR" "$INSTALL_DIR"
fi

log "Starting PM2"
cd "$NEW_DIR"
GIT_COMMIT="$DEPLOY_COMMIT" pm2 start infra/pm2.ecosystem.config.cjs
pm2 save

PORT="$(grep '^PORT=' "$NEW_DIR/web/.env" 2>/dev/null | cut -d= -f2- || echo "$PORT_DEFAULT")"
for i in $(seq 1 30); do
  sleep 2
  curl -fsS "http://127.0.0.1:${PORT}/api/healthz" >/tmp/pr63_after_web.json 2>/dev/null && break
  [ "$i" = 30 ] && die "web unhealthy"
done
curl -fsS "http://127.0.0.1:8787/health" >/tmp/pr63_after_mcp.json 2>/dev/null || true

python3 - <<PY
import json
w=json.load(open('/tmp/pr63_after_web.json'))
m=json.load(open('/tmp/pr63_after_mcp.json'))
exp='$DEPLOY_COMMIT'
print('after_web='+w.get('commit',''))
print('after_mcp='+m.get('commit',''))
print(('PASS' if w.get('commit')==exp else 'FAIL')+' web-health-pr63')
print(('PASS' if m.get('commit')==exp else 'FAIL')+' mcp-health-pr63')
if w.get('commit')!=exp or m.get('commit')!=exp:
  raise SystemExit(2)
PY

log "SUCCESS old=$OLD_TARGET backup=$BACKUP_DIR"
INNER

echo "rollback_target=$DEPLOY_COMMIT" | tee -a "$SUM"
echo "previous_commit=$PREVIOUS_COMMIT" | tee -a "$SUM"
echo "backup_dir=$BACKUP_DIR" | tee -a "$SUM"
echo "DONE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
