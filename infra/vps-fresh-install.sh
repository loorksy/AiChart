#!/usr/bin/env bash
# Fresh Lonora install on a VPS that already runs other projects.
#
# Creates only:
#   /opt/aichart
#   postgres role + database "aichart"
#   redis bound to localhost
#   /docker/traefik/dynamic/aichart.yml   (only if that directory already exists)
#   pm2 apps aichart-web, aichart-worker, aichart-mcp
#   docker container chart-host
#
# Does not install nginx, does not edit other Traefik files, and does not
# restart other pm2 apps or containers.
#
#   sudo bash infra/vps-fresh-install.sh
#
# Optional environment:
#   ADMIN_EMAIL=loorksy@gmail.com ADMIN_PASSWORD='…' bash infra/vps-fresh-install.sh
#   BRANCH=main APP_URL=https://aichart.lork.cloud
#
# The licensed TradingView library is not in git. Copy it before this script
# reaches the build, or the script stops and tells you the two paths.
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
REPO_URL="${REPO_URL:-https://github.com/loorksy/AiChart.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3010}"
APP_URL="${APP_URL:-https://aichart.lork.cloud}"
ADMIN_EMAIL="${ADMIN_EMAIL:-loorksy@gmail.com}"

log() { echo "[aichart-install] $*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "FATAL: $INSTALL_DIR exists and is not an AiChart checkout" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

log "packages"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get update -qq
apt-get install -y -qq nodejs build-essential python3 git curl iproute2 \
  postgresql postgresql-contrib redis-server \
  unzip xz-utils zip ca-certificates
systemctl enable --now postgresql
PG_MAJOR="$(sudo -u postgres psql -tAc 'SHOW server_version' | cut -d. -f1 | tr -d '[:space:]')"
apt-get install -y -qq "postgresql-${PG_MAJOR}-pgvector"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "FATAL: docker is required for chart-host and is not installed. Install it without replacing the existing engine, then re-run." >&2
  exit 1
fi
if ss -lnt | grep -q ":${PORT} "; then
  if ! pm2 describe aichart-web >/dev/null 2>&1; then
    echo "FATAL: port ${PORT} is already in use" >&2
    ss -lntp | grep ":${PORT} " || true
    exit 1
  fi
fi

log "postgres role/database aichart only"
ROLE_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='aichart'" | tr -d '[:space:]')"
if [ ! -f /root/aichart-db.pass ]; then
  if [ "$ROLE_EXISTS" = "1" ]; then
    echo "FATAL: role aichart exists but /root/aichart-db.pass is missing. Refusing to reset its password." >&2
    exit 1
  fi
  umask 077
  openssl rand -hex 16 > /root/aichart-db.pass
  chmod 600 /root/aichart-db.pass
fi
DB_PASS="$(tr -d '\n' < /root/aichart-db.pass)"
DB_PASS_SQL="${DB_PASS//\'/\'\'}"
if [ "$ROLE_EXISTS" != "1" ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE aichart LOGIN PASSWORD '${DB_PASS_SQL}'"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='aichart'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE aichart OWNER aichart"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE aichart TO aichart"
sudo -u postgres psql -d aichart -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

log "redis on localhost (existing config is left as-is)"
if systemctl list-unit-files --no-legend | awk '{print $1}' | grep -qx 'redis-server.service'; then
  systemctl enable --now redis-server
elif systemctl list-unit-files --no-legend | awk '{print $1}' | grep -qx 'redis.service'; then
  systemctl enable --now redis
else
  echo "FATAL: redis service not found after install" >&2
  exit 1
fi

log "checkout $BRANCH"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

ENV_FILE="$INSTALL_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  export INSTALL_DIR ADMIN_EMAIL PORT APP_URL DB_PASS
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    export ADMIN_PASSWORD
    export ADMIN_PASSWORD_GENERATED=0
  else
    export ADMIN_PASSWORD_GENERATED=1
  fi
  python3 - <<'PY'
import os, secrets, subprocess, sys
from pathlib import Path

install = Path(os.environ["INSTALL_DIR"])
if os.environ.get("ADMIN_PASSWORD_GENERATED") == "1":
    admin_password = secrets.token_urlsafe(18)
    boot = Path("/root/aichart-admin-bootstrap.txt")
    boot.write_text(admin_password + "\n")
    boot.chmod(0o600)
    print("[aichart-install] admin password written to /root/aichart-admin-bootstrap.txt")
else:
    admin_password = os.environ["ADMIN_PASSWORD"]
    if "\n" in admin_password or "\r" in admin_password:
        sys.exit("FATAL: ADMIN_PASSWORD must be a single line")

def fmt(value: str) -> str:
    if any(ch in value for ch in " \t#'\"\\$`"):
        if "'" in value:
            sys.exit("FATAL: a value that needs quoting cannot contain a single quote")
        return "'" + value + "'"
    return value

commit = subprocess.check_output(
    ["git", "-C", str(install), "rev-parse", "HEAD"], text=True
).strip()
port = os.environ["PORT"]
app = os.environ["APP_URL"].rstrip("/")
db_pass = os.environ["DB_PASS"].strip()
pairs = [
    ("ENCRYPTION_KEY", secrets.token_hex(32)),
    ("APP_SECRET", secrets.token_urlsafe(48)),
    ("ADMIN_EMAIL", os.environ["ADMIN_EMAIL"]),
    ("ADMIN_PASSWORD", admin_password),
    ("DATABASE_URL", f"postgresql://aichart:{db_pass}@127.0.0.1:5432/aichart"),
    ("REDIS_URL", "redis://127.0.0.1:6379/0"),
    ("CRON_SECRET", secrets.token_urlsafe(32)),
    ("AICHART_SERVICE_TOKEN", secrets.token_hex(32)),
    ("AICHART_API_URL", f"http://127.0.0.1:{port}"),
    ("CHART_HOST_URL", "http://127.0.0.1:8788"),
    ("MCP_AUTH_SECRET", secrets.token_hex(32)),
    ("MCP_AUTH_MODE", "oauth"),
    ("MCP_PORT", "8787"),
    ("MCP_PUBLIC_URL", app + "/mcp"),
    ("TELEGRAM_WEBHOOK_SECRET", secrets.token_hex(32)),
    ("AICHART_SINGLE_USER", "0"),
    ("APP_URL", app),
    ("PORT", port),
    ("NODE_ENV", "production"),
    ("FOREX_BACKEND", "oanda"),
    ("OANDA_ENV", "practice"),
    ("FEATURE_SMART_CHART_AGENT", "1"),
    ("FEATURE_NEWS_MACRO_AGENT", "1"),
    ("FEATURE_MCP_UNIFIED_ENGINE", "1"),
    ("FEATURE_AGENT_SKILLS", "1"),
    ("GIT_COMMIT", commit),
]
env_path = install / ".env"
env_path.write_text("".join(f"{key}={fmt(value)}\n" for key, value in pairs))
env_path.chmod(0o600)
print(f"[aichart-install] wrote {env_path}")
PY
else
  log ".env already exists — missing keys are filled, existing values kept"
fi

PUBLIC_TV="$INSTALL_DIR/public/charting_library/charting_library.standalone.js"
VENDOR_TV="$INSTALL_DIR/src/vendor/tradingview/charting_library/charting_library.d.ts"
if [ ! -s "$PUBLIC_TV" ] || [ ! -s "$VENDOR_TV" ]; then
  echo "FATAL: TradingView library is not in the checkout (it is gitignored)." >&2
  echo "Copy both trees, then re-run:" >&2
  echo "  $PUBLIC_TV" >&2
  echo "  $VENDOR_TV" >&2
  exit 42
fi

log "npm ci + build"
cd "$INSTALL_DIR"
npm ci
npm run build

if ! command -v flutter >/dev/null 2>&1; then
  if [ ! -x /opt/flutter/bin/flutter ]; then
    log "installing Flutter SDK into /opt/flutter"
    rm -rf /opt/flutter
    git clone --depth 1 -b stable https://github.com/flutter/flutter.git /opt/flutter
  fi
  export PATH="/opt/flutter/bin:$PATH"
fi
flutter --disable-analytics >/dev/null 2>&1 || true
bash "$INSTALL_DIR/infra/build-admin-app.sh"

if [ -d /docker/traefik/dynamic ]; then
  log "Traefik file aichart.yml only"
  nano_before=""
  if [ -f /docker/traefik/dynamic/nanoagent.yml ]; then
    nano_before="$(sha256sum /docker/traefik/dynamic/nanoagent.yml | awk '{print $1}')"
  fi
  cat > /docker/traefik/dynamic/aichart.yml <<YAML
http:
  routers:
    aichart:
      rule: Host(\`aichart.lork.cloud\`)
      entryPoints:
        - websecure
      service: aichart
      tls:
        certResolver: letsencrypt
  services:
    aichart:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:${PORT}
YAML
  chmod 644 /docker/traefik/dynamic/aichart.yml
  if [ -n "$nano_before" ]; then
    nano_after="$(sha256sum /docker/traefik/dynamic/nanoagent.yml | awk '{print $1}')"
    if [ "$nano_before" != "$nano_after" ]; then
      echo "FATAL: nanoagent.yml changed" >&2
      exit 1
    fi
  fi
else
  log "no /docker/traefik/dynamic — not installing nginx. Point the existing proxy at 127.0.0.1:${PORT}"
fi

log "pm2 aichart-* only"
cd "$INSTALL_DIR"
for app in aichart-web aichart-worker aichart-mcp; do
  pm2 delete "$app" >/dev/null 2>&1 || true
done
AICHART_INSTALL_DIR="$INSTALL_DIR" pm2 start "$INSTALL_DIR/infra/pm2.ecosystem.config.cjs"
pm2 save

ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/healthz" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "FATAL: web did not answer /api/healthz" >&2
  pm2 logs aichart-web --lines 40 --nostream || true
  exit 1
fi

INSTALL_DIR="$INSTALL_DIR" bash "$INSTALL_DIR/infra/vps-ensure-runtime.sh"
pm2 restart aichart-web aichart-worker aichart-mcp --update-env
pm2 save

log "done"
echo "web:      ${APP_URL}"
echo "health:   $(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/api/healthz)"
echo "chart:    $(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/healthz)"
echo "admin pw: /root/aichart-admin-bootstrap.txt (only on a brand-new .env)"
echo "still empty until you edit .env: OPENAI_API_KEY OANDA_API_TOKEN OANDA_ACCOUNT_ID TELEGRAM_BOT_TOKEN"
pm2 list
