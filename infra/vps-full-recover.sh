#!/usr/bin/env bash
# Full AiChart recovery after accidental /opt/aichart deletion.
# Preserves: PostgreSQL aichart DB, SSL cert, cron secrets.
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"
PORT="${PORT:-3010}"
DOMAIN="aichart.lork.cloud"
CRON_FILE="/etc/cron.d/aichart"

log() { echo "[recover] $*"; }

log "1) prerequisites"
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; apt-get install -y nodejs build-essential; }
command -v pm2 >/dev/null || npm install -g pm2
command -v git >/dev/null || apt-get install -y git

log "2) clone repo"
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin main
  git -C "$INSTALL_DIR" reset --hard origin/main
else
  git clone --branch main https://github.com/loorksy/AiChart.git "$INSTALL_DIR"
fi
echo "$PORT" >"$INSTALL_DIR/.deploy-port"
log "commit: $(git -C "$INSTALL_DIR" log --oneline -1)"

log "3) strip CRLF from shell scripts"
find "$INSTALL_DIR/infra" "$INSTALL_DIR/agent/scripts" -name '*.sh' -type f | while read -r f; do
  sed -i 's/\r$//' "$f"
  chmod +x "$f"
done

log "4) postgres password + pgvector"
DB_PASS="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER aichart WITH PASSWORD '${DB_PASS}';" 2>/dev/null \
  || sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER aichart WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE aichart TO aichart;" 2>/dev/null || true
sudo -u postgres psql -d aichart -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
apt-get install -y postgresql-16-pgvector 2>/dev/null || true

log "5) rebuild web/.env"
mkdir -p "$WEB_DIR/data"
ENC_KEY="$(openssl rand -hex 32)"
APP_SEC="$(openssl rand -base64 48 | tr -d '\n')"
SVC_TOKEN="$(openssl rand -hex 32)"
CRON_SECRET="$(grep -oE 'Bearer [^"]+' "$CRON_FILE" 2>/dev/null | head -1 | cut -d' ' -f2- || openssl rand -base64 32 | tr -d '\n')"
GW_TOKEN="$(openssl rand -hex 32)"
DATABASE_URL="postgresql://aichart:${DB_PASS}@127.0.0.1:5432/aichart"

cat >"$ENV_FILE" <<EOF
ENCRYPTION_KEY=${ENC_KEY}
APP_SECRET=${APP_SEC}
DATABASE_URL=${DATABASE_URL}
ADMIN_EMAIL=loorksy@gmail.com
ADMIN_PASSWORD=change-this-password
PORT=${PORT}
NODE_ENV=production
APP_URL=https://${DOMAIN}
CRON_SECRET=${CRON_SECRET}
AICHART_SERVICE_TOKEN=${SVC_TOKEN}
AICHART_SINGLE_USER=1
AICHART_GATE_PASSWORD=Ahmetlork0009
ENABLE_BINANCE_CLI=0
OPENCLAW_CONFIG=/root/.openclaw/openclaw.json
OPENCLAW_AUTO_RESTART=1
OPENCLAW_CONSOLE_URL=https://${DOMAIN}/openclaw/
OPENCLAW_GATEWAY_TOKEN=${GW_TOKEN}
EOF
chmod 600 "$ENV_FILE"

log "6) persist bootstrap keys in platform_config"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO platform_config (key, value, plain, updated_at)
VALUES
  ('ENCRYPTION_KEY', '${ENC_KEY}', TRUE, NOW()),
  ('APP_SECRET', '${APP_SEC}', TRUE, NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, plain = TRUE, updated_at = NOW();
SQL

log "7) npm install + build"
cd "$WEB_DIR"
npm install
npm run build

log "8) pm2 aichart-web"
pm2 delete aichart-web 2>/dev/null || true
cat > "$INSTALL_DIR/infra/pm2.aichart.cjs" <<EOF
module.exports = {
  apps: [
    {
      name: "aichart-web",
      cwd: "${WEB_DIR}",
      script: "npm",
      args: "start",
      instances: 1,
      autorestart: true,
      max_memory_restart: "768M",
      env: { NODE_ENV: "production", PORT: ${PORT} },
    },
  ],
};
EOF
pm2 start "$INSTALL_DIR/infra/pm2.aichart.cjs"
pm2 save

log "9) install openclaw + minimal config"
npm install -g openclaw@latest
mkdir -p /root/.openclaw/workspace
node - "$GW_TOKEN" <<'NODE'
const fs = require("fs");
const gw = process.argv[2];
const cfg = {
  gateway: {
    port: 18789,
    auth: { token: gw },
    controlUi: {
      enabled: true,
      basePath: "/openclaw",
      allowedOrigins: ["https://aichart.lork.cloud"],
    },
  },
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-haiku-4-5-20251001" },
      thinkingDefault: "off",
      contextPruning: { mode: "cache-ttl" },
      models: {
        "anthropic/claude-haiku-4-5-20251001": {
          params: { cacheRetention: "long", thinking: "off" },
        },
      },
    },
  },
  channels: { telegram: { enabled: false } },
  tools: {
    exec: { security: "allowlist", ask: "on-miss" },
    media: {
      audio: {
        enabled: true,
        models: [
          {
            type: "cli",
            command: "bash",
            args: [
              "-c",
              'curl -sf -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" -F "file=@$1" "${AICHART_API_URL:-http://127.0.0.1:3010}/api/agent/transcribe"',
              "_",
              "{{MediaPath}}",
            ],
            timeoutSeconds: 90,
          },
        ],
      },
    },
  },
  models: {
    providers: {
      anthropic: {
        models: [{ id: "claude-haiku-4-5-20251001", name: "claude-haiku-4-5-20251001" }],
      },
    },
  },
};
fs.writeFileSync("/root/.openclaw/openclaw.json", JSON.stringify(cfg, null, 2) + "\n");
console.log("openclaw.json created");
NODE

cat > /root/.openclaw/.env <<EOF
AICHART_API_URL=http://127.0.0.1:${PORT}
AICHART_SERVICE_TOKEN=${SVC_TOKEN}
EOF

log "10) sync workspace + model"
bash "$INSTALL_DIR/agent/scripts/sync-workspace.sh"
set -a
source "$ENV_FILE"
set +a
export AICHART_API_URL="http://127.0.0.1:${PORT}"
bash "$INSTALL_DIR/agent/scripts/sync-model.sh" || log "sync-model warn (re-save keys in admin)"

log "11) pm2 aichart-agent"
pm2 delete aichart-agent 2>/dev/null || true
pm2 start "$INSTALL_DIR/infra/aichart-agent.sh" --name aichart-agent --interpreter bash --update-env
pm2 save

log "12) nginx vhost"
cat > /etc/nginx/sites-available/aichart.lork.cloud <<'NGINX'
server {
    server_name aichart.lork.cloud www.aichart.lork.cloud;

    # aichart-openclaw-proxy
    location ^~ /openclaw {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/aichart.lork.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aichart.lork.cloud/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = aichart.lork.cloud) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name aichart.lork.cloud www.aichart.lork.cloud;
    return 404;
}
NGINX

ln -sf /etc/nginx/sites-available/aichart.lork.cloud /etc/nginx/sites-enabled/aichart.lork.cloud
nginx -t
systemctl reload nginx

log "13) update cron domain (idempotent)"
if [[ -f "$INSTALL_DIR/infra/aichart.cron" ]]; then
  sed -e "s|YOUR_DOMAIN|${DOMAIN}|g" \
      -e "s|YOUR_CRON_SECRET|${CRON_SECRET}|g" \
    "$INSTALL_DIR/infra/aichart.cron" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
fi

sleep 5
log "14) verification"
curl -fsS -o /dev/null -w "local web: %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -fsS -o /dev/null -w "HTTPS: %{http_code}\n" "https://${DOMAIN}/" || true
pm2 list | grep aichart || true
curl -sS -H "Authorization: Bearer ${SVC_TOKEN}" "http://127.0.0.1:${PORT}/api/agent/model" || true
echo ""
log "DONE — commit $(git -C $INSTALL_DIR log --oneline -1)"
log "IMPORTANT: .env was recreated. Re-enter API keys in https://${DOMAIN}/admin/keys"
log "           (Anthropic, Telegram, Binance) — old encrypted values need new ENCRYPTION_KEY."
