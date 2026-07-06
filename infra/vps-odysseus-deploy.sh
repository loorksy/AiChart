#!/usr/bin/env bash
# Deploy Odysseus as primary chat UI on VPS (PM2 + nginx + AiChart bridge).
# Run on VPS as root after git pull:
#   bash /opt/aichart/infra/vps-odysseus-deploy.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"
ODY_DIR="$INSTALL_DIR/odysseusai"
WEB_DIR="$INSTALL_DIR/web"
NGINX_SITE="/etc/nginx/sites-available/odysseus.lork.cloud"
ODY_DOMAIN="${ODY_DOMAIN:-odysseus.lork.cloud}"
AICHART_PUBLIC="${AICHART_PUBLIC:-https://aichart.lork.cloud}"
ODY_PORT="${ODY_PORT:-7000}"

log() { echo "[odysseus-deploy] $*"; }

cd "$INSTALL_DIR"
log "Repo at: $(git log --oneline -1)"

mkdir -p "$ODY_DIR/data" "$ODY_DIR/logs"

if [ ! -d "$ODY_DIR/venv" ]; then
  log "Creating Python venv..."
  python3 -m venv "$ODY_DIR/venv"
fi

log "Installing Python dependencies..."
"$ODY_DIR/venv/bin/pip" install -q --upgrade pip
"$ODY_DIR/venv/bin/pip" install -q -r "$ODY_DIR/requirements.txt"

# Build odysseus .env from example + AiChart bridge token from web/.env
if [ ! -f "$ODY_DIR/.env" ]; then
  cp "$ODY_DIR/.env.example" "$ODY_DIR/.env"
fi

AICHART_TOKEN=""
if [ -f "$WEB_DIR/.env" ]; then
  AICHART_TOKEN="$(grep '^AICHART_SERVICE_TOKEN=' "$WEB_DIR/.env" | cut -d= -f2- | tr -d '\r' || true)"
fi

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ODY_DIR/.env"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ODY_DIR/.env"
  else
    echo "${key}=${val}" >>"$ODY_DIR/.env"
  fi
}

set_env "APP_BIND" "127.0.0.1"
set_env "APP_PORT" "$ODY_PORT"
set_env "SECURE_COOKIES" "true"
set_env "LOCALHOST_BYPASS" "false"
set_env "AUTH_ENABLED" "true"
set_env "AICHART_BASE_URL" "$AICHART_PUBLIC"
set_env "ALLOWED_ORIGINS" "https://${ODY_DOMAIN}"
if [ -n "$AICHART_TOKEN" ]; then
  set_env "AICHART_SERVICE_TOKEN" "$AICHART_TOKEN"
else
  log "WARN: AICHART_SERVICE_TOKEN missing in web/.env — trading bridge will fail"
fi

# Allow Odysseus to iframe AiChart embed (build-time on Next.js)
if [ -f "$WEB_DIR/.env" ]; then
  if grep -q '^ODYSSEUS_FRAME_ORIGINS=' "$WEB_DIR/.env"; then
    sed -i "s|^ODYSSEUS_FRAME_ORIGINS=.*|ODYSSEUS_FRAME_ORIGINS=https://${ODY_DOMAIN}|" "$WEB_DIR/.env"
  else
    echo "ODYSSEUS_FRAME_ORIGINS=https://${ODY_DOMAIN}" >>"$WEB_DIR/.env"
  fi
fi

log "PM2 odysseus on 127.0.0.1:${ODY_PORT}"
if pm2 describe odysseus >/dev/null 2>&1; then
  pm2 delete odysseus || true
fi
pm2 start "$ODY_DIR/venv/bin/python" \
  --name odysseus \
  --cwd "$ODY_DIR" \
  --interpreter none \
  -- \
  -m uvicorn app:app \
  --host 127.0.0.1 \
  --port "$ODY_PORT" \
  --proxy-headers \
  --forwarded-allow-ips=127.0.0.1

sleep 3
curl -fsS -o /dev/null -w "odysseus local HTTP %{http_code}\n" "http://127.0.0.1:${ODY_PORT}/" || log "WARN: local health check failed"

log "nginx + TLS for ${ODY_DOMAIN}"
if [ ! -f "/etc/letsencrypt/live/${ODY_DOMAIN}/fullchain.pem" ]; then
  # Bootstrap HTTP vhost for certbot
  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    server_name ${ODY_DOMAIN};
    location / {
        proxy_pass http://127.0.0.1:${ODY_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/odysseus.lork.cloud
  nginx -t && systemctl reload nginx
  certbot certonly --nginx -d "$ODY_DOMAIN" --non-interactive --agree-tos \
    -m "admin@${ODY_DOMAIN#*.}" || certbot certonly --webroot -w /var/www/html -d "$ODY_DOMAIN" \
    --non-interactive --agree-tos -m "admin@lork.cloud" || log "WARN: certbot failed — configure TLS manually"
fi

if [ -f "$INSTALL_DIR/infra/nginx/odysseus.lork.cloud.conf" ]; then
  cp "$INSTALL_DIR/infra/nginx/odysseus.lork.cloud.conf" "$NGINX_SITE"
  ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/odysseus.lork.cloud
  nginx -t && systemctl reload nginx
fi

log "Rebuild AiChart web (ODYSSEUS_FRAME_ORIGINS)..."
cd "$WEB_DIR"
pm2 stop aichart-web 2>/dev/null || true
rm -rf .next
npm install
npm run build
pm2 restart aichart-web --update-env || (
  PORT=3010 NODE_ENV=production pm2 start npm --name aichart-web --cwd "$WEB_DIR" --update-env -- start
)

pm2 save

curl -fsS -o /dev/null -w "HTTPS ${ODY_DOMAIN} -> %{http_code}\n" "https://${ODY_DOMAIN}/" || true
curl -fsS -o /dev/null -w "HTTPS aichart manifest -> %{http_code}\n" "${AICHART_PUBLIC}/api/integrations/odysseus/manifest" || true
pm2 list | grep -E 'odysseus|aichart-web' || true
log "Done — open https://${ODY_DOMAIN}"
