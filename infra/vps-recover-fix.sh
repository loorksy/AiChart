#!/usr/bin/env bash
# Complete AiChart VPS recovery when /opt/aichart was deleted/re-cloned.
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"
PORT=3010
DOMAIN="aichart.lork.cloud"
OPENCLAW_JSON="/root/.openclaw/openclaw.json"
CRON_FILE="/etc/cron.d/aichart"

log() { echo "[recover-fix] $*"; }

log "1) git sync"
cd "$INSTALL_DIR"
git fetch origin main
git checkout main
git reset --hard origin/main
log "commit: $(git log --oneline -1)"

log "2) CRLF fix"
find "$INSTALL_DIR/infra" "$INSTALL_DIR/agent/scripts" -name '*.sh' -type f | while read -r f; do
  sed -i 's/\r$//' "$f"
  chmod +x "$f"
done

log "3) ensure PORT in .env"
mkdir -p "$WEB_DIR/data"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^PORT=' "$ENV_FILE"; then
    sed -i "s|^PORT=.*|PORT=${PORT}|" "$ENV_FILE"
  else
    echo "PORT=${PORT}" >>"$ENV_FILE"
  fi
else
  log "ERROR: $ENV_FILE missing — run vps-full-recover.sh first"
  exit 1
fi

log "4) pgvector"
sudo -u postgres psql -d aichart -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true

log "5) npm install + build"
cd "$WEB_DIR"
npm install
npm run build

log "6) pm2 aichart-web on port ${PORT}"
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
pm2 delete aichart-web pm2.aichart 2>/dev/null || true
cd "$WEB_DIR"
PORT=${PORT} NODE_ENV=production pm2 start npm --name aichart-web --cwd "$WEB_DIR" --update-env -- start
pm2 save

log "7) openclaw.json repair"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
GW_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(openssl rand -hex 32)}"
SVC="${AICHART_SERVICE_TOKEN}"
API_URL="http://127.0.0.1:${PORT}"

mkdir -p /root/.openclaw/workspace
node - "$OPENCLAW_JSON" "$GW_TOKEN" <<'NODE'
const fs = require("fs");
const [, , path, gwToken] = process.argv;
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch { cfg = {}; }

const patch = {
  gateway: {
    mode: "local",
    port: 18789,
    auth: { token: gwToken },
    controlUi: {
      enabled: true,
      basePath: "/openclaw",
      allowedOrigins: ["https://aichart.lork.cloud"],
    },
  },
  agents: {
    defaults: {
      thinkingDefault: "off",
      contextPruning: { mode: "cache-ttl" },
      models: {
        "anthropic/claude-haiku-4-5-20251001": {
          params: { cacheRetention: "long", thinking: "off" },
        },
      },
    },
  },
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

function deepMerge(t, s) {
  for (const k of Object.keys(s)) {
    if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k]) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) {
      deepMerge(t[k], s[k]);
    } else {
      t[k] = s[k];
    }
  }
  return t;
}
deepMerge(cfg, patch);
delete cfg.agents?.defaults?.heartbeat;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("openclaw.json repaired (gateway.mode=local)");
NODE

cat > /root/.openclaw/.env <<EOF
AICHART_API_URL=${API_URL}
AICHART_SERVICE_TOKEN=${SVC}
EOF

log "8) sync workspace + model"
bash "$INSTALL_DIR/agent/scripts/sync-workspace.sh"
export AICHART_API_URL="$API_URL"
export OPENCLAW_AUTO_RESTART=1
bash "$INSTALL_DIR/agent/scripts/sync-model.sh" || log "sync-model warn"

log "9) pm2 aichart-agent"
pm2 delete aichart-agent 2>/dev/null || true
pm2 start "$INSTALL_DIR/infra/aichart-agent.sh" --name aichart-agent --interpreter bash --update-env
pm2 save

log "10) nginx"
if [[ -f /etc/nginx/sites-available/aichart.lork.cloud ]]; then
  nginx -t && systemctl reload nginx
else
  log "nginx vhost missing — run vps-full-recover.sh step 12 or vps-nginx-openclaw.sh"
fi

log "11) cron"
if [[ -f "$INSTALL_DIR/infra/aichart.cron" ]]; then
  CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  sed -e "s|YOUR_DOMAIN|${DOMAIN}|g" \
      -e "s|YOUR_CRON_SECRET|${CRON_SECRET}|g" \
    "$INSTALL_DIR/infra/aichart.cron" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
fi

sleep 6
log "12) verify"
curl -fsS -o /dev/null -w "local web: %{http_code}\n" "http://127.0.0.1:${PORT}/" || true
curl -fsS -o /dev/null -w "HTTPS: %{http_code}\n" "https://${DOMAIN}/" || true
pm2 list | grep aichart || true
curl -sS -H "Authorization: Bearer ${SVC}" "${API_URL}/api/agent/model" || true
echo ""
pm2 logs aichart-agent --lines 8 --nostream 2>&1 | tail -10 || true
log "DONE — if agent decrypt fails, re-save API keys at https://${DOMAIN}/admin/keys"
