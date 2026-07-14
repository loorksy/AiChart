#!/usr/bin/env bash
# AiChart VPS deploy — does NOT stop/restart other PM2 apps or services.
# Usage (on VPS as root):
#   curl -fsSL https://raw.githubusercontent.com/loorksy/AiChart/main/infra/deploy-vps.sh | bash
# Or after clone:
#   bash /opt/aichart/infra/deploy-vps.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/loorksy/AiChart.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
APP_NAME="${APP_NAME:-aichart-web}"
BRANCH="${BRANCH:-main}"

log() { echo "[deploy] $*"; }

pick_free_port() {
  local p
  for p in 3010 3011 3020 3030 3040 3050 3060 3070 3080 3090 3100; do
    if ! ss -tln 2>/dev/null | grep -q ":${p} "; then
      echo "$p"
      return 0
    fi
  done
  echo "ERROR: no free port in range 3010-3100" >&2
  exit 1
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [ "$major" -ge 20 ]; then
      log "Node $(node -v) OK"
      return 0
    fi
  fi
  log "Installing Node.js 22.x (nodesource)..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs build-essential python3
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "PM2 OK"
    return 0
  fi
  log "Installing PM2 globally..."
  npm install -g pm2
}

clone_or_pull() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating $INSTALL_DIR..."
    git -C "$INSTALL_DIR" fetch origin
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    log "Cloning into $INSTALL_DIR..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
}

write_env_if_missing() {
  local env_file="$INSTALL_DIR/web/.env"
  if [ -f "$env_file" ]; then
    log ".env exists — keeping current secrets"
    return 0
  fi
  log "Creating web/.env with generated secrets..."
  local enc app admin cron svc port ip
  enc="$(openssl rand -hex 32)"
  app="$(openssl rand -base64 48 | tr -d '\n')"
  admin="$(openssl rand -base64 24 | tr -d '\n')"
  cron="$(openssl rand -base64 32 | tr -d '\n')"
  svc="$(openssl rand -hex 32)"
  port="$(cat "$INSTALL_DIR/.deploy-port" 2>/dev/null || pick_free_port)"
  ip="$(curl -fsS -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  cat >"$env_file" <<EOF
ENCRYPTION_KEY=$enc
APP_SECRET=$app
ADMIN_EMAIL=admin@aichart.local
ADMIN_PASSWORD=$admin
DB_PATH=data/aichart.db
OPENAI_API_KEY=
AI_MODEL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
CRON_SECRET=$cron
AICHART_SINGLE_USER=0
AICHART_SERVICE_TOKEN=$svc
APP_URL=http://${ip}:${port}
PORT=${port}
NODE_ENV=production
EOF
  chmod 600 "$env_file"
  log "Generated a unique bootstrap password in $env_file (mode 600)."
  log "IMPORTANT: set OPENAI_API_KEY and APP_URL (domain) before public use."
  log "MCP: deploy with infra/vps-mcp-deploy.sh (uses AICHART_SERVICE_TOKEN from web/.env)."
}

main() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root (or sudo bash deploy-vps.sh)" >&2
    exit 1
  fi

  ensure_node
  ensure_pm2
  clone_or_pull

  PORT="${PORT:-}"
  if [ -z "$PORT" ]; then
    if [ -f "$INSTALL_DIR/.deploy-port" ]; then
      PORT="$(cat "$INSTALL_DIR/.deploy-port")"
      if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
        log "Saved port $PORT in use by another process — picking new port"
        PORT=""
      fi
    fi
  fi
  if [ -z "$PORT" ]; then
    PORT="$(pick_free_port)"
  fi
  echo "$PORT" >"$INSTALL_DIR/.deploy-port"
  log "Using port $PORT (other projects untouched)"

  write_env_if_missing

  cd "$INSTALL_DIR/web"
  mkdir -p data
  log "npm ci..."
  npm ci
  log "npm run build..."
  npm run build

  local pm2_file="$INSTALL_DIR/infra/pm2.production.cjs"
  cat >"$pm2_file" <<EOF
module.exports = {
  apps: [
    {
      name: "${APP_NAME}",
      cwd: "${INSTALL_DIR}/web",
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production",
        PORT: ${PORT},
      },
    },
    {
      name: "aichart-worker",
      cwd: "${INSTALL_DIR}/web",
      script: "npm",
      args: "run worker",
      instances: 1,
      autorestart: true,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
EOF

  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    log "Reloading PM2 app '$APP_NAME' only..."
    pm2 delete "$APP_NAME" || true
  fi
  log "Starting PM2 app '$APP_NAME' on port $PORT..."
  pm2 start "$pm2_file"
  pm2 save

  log "Done."
  log "URL: http://$(hostname -I | awk '{print $1}'):${PORT}"
  log "PM2: pm2 logs $APP_NAME"
  log "Other PM2 apps were NOT restarted."
  pm2 list
}

main "$@"
