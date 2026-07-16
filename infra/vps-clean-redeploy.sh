#!/usr/bin/env bash
# AiChart — clean production redeploy with inventory, backup, and verification.
#
# Implements the runtime-integration redeploy flow:
#   1. INVENTORY   — record services, processes, containers, images, volumes,
#                    project copies, env files, and the current commit.
#   2. BACKUP      — database + env files + PM2 dump + licensed TradingView
#                    directories into a root-only dir.
#   3. CLEANUP     — stop AiChart apps, remove old AiChart containers/images
#                    and stale project copies (AiChart-only; never system-wide).
#   4. FRESH CLONE — deploy verified origin/main into a new directory, restore
#                    protected env and licensed assets, build, migrate, start.
#   5. VERIFY      — health endpoints must report the exact deployed commit.
#
# Safe by design: refuses to run without an explicit "GO" argument, never
# touches non-AiChart services, never deletes databases/volumes/certs/uploads,
# and never prints secret values.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
REPO_URL="${REPO_URL:-$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || echo "")}"
BRANCH="${BRANCH:-main}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/aichart-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
NEW_DIR="${NEW_DIR:-/opt/aichart-$STAMP}"
PORT_DEFAULT=3010
TRADINGVIEW_PUBLIC_REL="web/public/charting_library"
TRADINGVIEW_VENDOR_REL="web/src/vendor/tradingview"
TRADINGVIEW_BACKUP_DIR="$BACKUP_DIR/licensed-tradingview"

log() { echo "[clean-redeploy] $*"; }
die() { echo "[clean-redeploy] FATAL: $*" >&2; exit 1; }

verify_nonempty_asset_dir() {
  local dir="$1" label="$2"
  local first_file=""
  [ -d "$dir" ] || die "$label is missing."
  [ ! -L "$dir" ] || die "$label must be a real directory, not a symlink."
  first_file="$(find "$dir" -type f -size +0c -print -quit 2>/dev/null || true)"
  [ -n "$first_file" ] || die "$label contains no non-empty files."
}

verify_tradingview_assets() {
  local root="$1" context="$2"
  local public_dir="$root/$TRADINGVIEW_PUBLIC_REL"
  local vendor_dir="$root/$TRADINGVIEW_VENDOR_REL"

  verify_nonempty_asset_dir "$public_dir" "$context TradingView runtime directory"
  verify_nonempty_asset_dir "$vendor_dir" "$context TradingView typings directory"
  [ -s "$public_dir/charting_library.standalone.js" ] ||
    die "$context TradingView runtime bundle is missing or empty."
  if [ ! -s "$vendor_dir/charting_library.d.ts" ] &&
    [ ! -s "$vendor_dir/charting_library/charting_library.d.ts" ]; then
    die "$context TradingView typings are missing or empty."
  fi
}

[ "${1:-}" = "GO" ] || die "Dry-run protection: run with 'GO' after reviewing this script."
[ "$(id -u)" -eq 0 ] || die "Run as root."
[ -n "$REPO_URL" ] || die "REPO_URL not set and $INSTALL_DIR has no origin remote."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"
umask 077

# ── 1. Inventory ────────────────────────────────────────────────────────────
log "Inventory → $BACKUP_DIR/inventory.txt"
{
  echo "== timestamp ==";            date -u
  echo "== current commit ==";       git -C "$INSTALL_DIR" log --oneline -3 2>/dev/null || echo "no git checkout"
  echo "== pm2 ==";                  pm2 ls 2>/dev/null || true
  echo "== systemd (aichart) ==";    systemctl list-units --all 'aichart*' --no-pager 2>/dev/null || true
  echo "== docker containers ==";    docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true
  echo "== docker images ==";        docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}' 2>/dev/null || true
  echo "== docker volumes ==";       docker volume ls 2>/dev/null || true
  echo "== docker networks ==";      docker network ls 2>/dev/null || true
  echo "== project copies ==";       ls -la /opt | grep -i aichart || true
  echo "== nginx sites ==";          ls /etc/nginx/sites-enabled 2>/dev/null || true
  echo "== crontab ==";              ls /etc/cron.d 2>/dev/null | grep -i aichart || true
} >"$BACKUP_DIR/inventory.txt" 2>&1

# ── 2. Backup ──────────────────────────────────────────────────────────────
log "Backing up env files, PM2 dump, database, and licensed TradingView assets"
for f in "$INSTALL_DIR/web/.env" "$INSTALL_DIR/mcp/.env" "$INSTALL_DIR/research-service/.env"; do
  [ -f "$f" ] && cp -a "$f" "$BACKUP_DIR/$(echo "$f" | tr '/' '_')"
done
pm2 save 2>/dev/null || true
[ -f /root/.pm2/dump.pm2 ] && cp -a /root/.pm2/dump.pm2 "$BACKUP_DIR/dump.pm2" || true

# These directories are licensed and gitignored, so a fresh clone cannot
# recreate them. Fail before stopping services if the installed copy is not
# complete, then keep a root-only backup without printing asset contents.
verify_tradingview_assets "$INSTALL_DIR" "Installed"
mkdir -p \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL" \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL"
cp -a -- \
  "$INSTALL_DIR/$TRADINGVIEW_PUBLIC_REL/." \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL/"
cp -a -- \
  "$INSTALL_DIR/$TRADINGVIEW_VENDOR_REL/." \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL/"
verify_tradingview_assets "$TRADINGVIEW_BACKUP_DIR" "Backed-up"
log "Licensed TradingView assets backed up and verified."

DATABASE_URL="$(grep '^DATABASE_URL=' "$INSTALL_DIR/web/.env" 2>/dev/null | cut -d= -f2- || true)"
if [ -n "$DATABASE_URL" ]; then
  log "pg_dump (custom format)"
  pg_dump --format=custom --dbname="$DATABASE_URL" --file="$BACKUP_DIR/aichart.pgdump"
  pg_restore --list "$BACKUP_DIR/aichart.pgdump" >/dev/null || die "pg_dump validation failed"
elif [ -f "$INSTALL_DIR/web/data/aichart.db" ]; then
  log "sqlite .backup"
  sqlite3 "$INSTALL_DIR/web/data/aichart.db" ".backup '$BACKUP_DIR/aichart.db'"
  cp -a "$INSTALL_DIR/web/data" "$BACKUP_DIR/web-data" 2>/dev/null || true
else
  log "WARN: no database found to back up"
fi
log "Backup complete: $(ls -la "$BACKUP_DIR" | wc -l) entries (verify before proceeding on failures)"

# ── 3. Stop + cleanup (AiChart only) ───────────────────────────────────────
log "Stopping AiChart PM2 apps"
for app in aichart-web aichart-worker aichart-mcp aichart-agent; do
  pm2 delete "$app" 2>/dev/null || true
done
pm2 save --force 2>/dev/null || true

if command -v docker >/dev/null 2>&1; then
  log "Removing AiChart application containers (never volumes, never other projects)"
  while IFS= read -r name; do
    docker rm -f "$name" || true
  done < <(
    docker ps -a --format '{{.Names}}' |
      grep -Ei '^(aichart|infra)[-_](web|mcp|worker|research|mt5|redis)([-_][0-9]+)?$' ||
      true
  )
  log "Removing obsolete AiChart application images"
  while IFS= read -r img; do
    docker rmi "$img" 2>/dev/null || true
  done < <(
    docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' |
      grep -Ei '^(aichart|infra)[-_](web|mcp|worker|research|mt5):[^[:space:]]+[[:space:]]' |
      awk '{print $2}' ||
      true
  )
  # NOTE: no docker system prune / volume prune — persistent data stays.
fi

# ── 4. Fresh clone + restore + build ───────────────────────────────────────
log "Fresh clone → $NEW_DIR"
git clone --branch "$BRANCH" "$REPO_URL" "$NEW_DIR"
DEPLOY_COMMIT="$(git -C "$NEW_DIR" rev-parse HEAD)"
log "Deploying commit $DEPLOY_COMMIT"

log "Restoring protected env files"
for f in web mcp research-service; do
  src="$BACKUP_DIR/$(echo "$INSTALL_DIR/$f/.env" | tr '/' '_')"
  [ -f "$src" ] && install -m 600 "$src" "$NEW_DIR/$f/.env" || true
done
grep -q '^GIT_COMMIT=' "$NEW_DIR/web/.env" 2>/dev/null || echo "GIT_COMMIT=$DEPLOY_COMMIT" >>"$NEW_DIR/web/.env"
sed -i "s/^GIT_COMMIT=.*/GIT_COMMIT=$DEPLOY_COMMIT/" "$NEW_DIR/web/.env"

log "Restoring licensed TradingView assets into the fresh clone"
mkdir -p \
  "$NEW_DIR/$TRADINGVIEW_PUBLIC_REL" \
  "$NEW_DIR/$TRADINGVIEW_VENDOR_REL"
cp -a -- \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_PUBLIC_REL/." \
  "$NEW_DIR/$TRADINGVIEW_PUBLIC_REL/"
cp -a -- \
  "$TRADINGVIEW_BACKUP_DIR/$TRADINGVIEW_VENDOR_REL/." \
  "$NEW_DIR/$TRADINGVIEW_VENDOR_REL/"
verify_tradingview_assets "$NEW_DIR" "Restored"
log "Licensed TradingView assets restored and verified."

log "Building web"
cd "$NEW_DIR/web" && npm ci && npm run build
log "Building mcp"
cd "$NEW_DIR/mcp" && npm ci && npm run build

# Migrations run automatically at web startup (CREATE TABLE IF NOT EXISTS /
# additive migrations). Nothing destructive executes here.

log "Repointing $INSTALL_DIR → $NEW_DIR (old copy kept until verification)"
OLD_TARGET=""
if [ -L "$INSTALL_DIR" ]; then
  OLD_TARGET="$(readlink -f "$INSTALL_DIR")"
  ln -sfn "$NEW_DIR" "$INSTALL_DIR"
elif [ -d "$INSTALL_DIR" ]; then
  OLD_TARGET="${INSTALL_DIR}-old-$STAMP"
  mv "$INSTALL_DIR" "$OLD_TARGET"
  ln -s "$NEW_DIR" "$INSTALL_DIR"
fi

log "Starting PM2 stack"
cd "$NEW_DIR"
GIT_COMMIT="$DEPLOY_COMMIT" pm2 start infra/pm2.ecosystem.config.cjs
pm2 save

# ── 5. Verify ──────────────────────────────────────────────────────────────
PORT="$(grep '^PORT=' "$NEW_DIR/web/.env" 2>/dev/null | cut -d= -f2- || echo "$PORT_DEFAULT")"
log "Waiting for web on :$PORT"
for i in $(seq 1 30); do
  sleep 2
  if curl -fsS "http://127.0.0.1:${PORT}/api/healthz" >/tmp/healthz.json 2>/dev/null; then break; fi
  [ "$i" = 30 ] && die "web did not become healthy — rollback: pm2 delete all; ln -sfn $OLD_TARGET $INSTALL_DIR; pm2 resurrect"
done
SERVING_COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/healthz.json","utf8")).commit||"")')"
log "healthz commit: $SERVING_COMMIT"
[ "$SERVING_COMMIT" = "$DEPLOY_COMMIT" ] || die "Serving commit mismatch: $SERVING_COMMIT != $DEPLOY_COMMIT"

if curl -fsS "http://127.0.0.1:8787/health" >/tmp/mcp-health.json 2>/dev/null; then
  MCP_COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/mcp-health.json","utf8")).commit||"")')"
  log "mcp commit: $MCP_COMMIT"
  [ "$MCP_COMMIT" = "$DEPLOY_COMMIT" ] || log "WARN: MCP commit mismatch — restart aichart-mcp"
else
  log "WARN: MCP health not reachable on :8787"
fi

log "SUCCESS. Old copy kept at: ${OLD_TARGET:-none} (remove manually after full verification)"
log "Backup at: $BACKUP_DIR"
