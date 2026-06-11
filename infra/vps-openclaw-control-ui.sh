#!/usr/bin/env bash
# Enable OpenClaw Control Web UI at /openclaw/ behind nginx reverse proxy.
set -euo pipefail

CONFIG="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"
WEB_ENV="${WEB_ENV:-/opt/aichart/web/.env}"
ORIGIN="${OPENCLAW_ALLOWED_ORIGIN:-https://aichart.lork.cloud}"
BASE_PATH="${OPENCLAW_BASE_PATH:-/openclaw}"

log() { echo "[openclaw-ui] $*"; }

[[ -f "$CONFIG" ]] || { log "missing $CONFIG — run openclaw onboard first"; exit 1; }

# Sync gateway token into web/.env if present in openclaw.json
GW_TOKEN="$(node -e "
  const c = require(process.argv[1]);
  const t = c.gateway?.auth?.token;
  if (t) process.stdout.write(t);
" "$CONFIG" 2>/dev/null || true)"

if [[ -n "$GW_TOKEN" && -f "$WEB_ENV" ]]; then
  if grep -q '^OPENCLAW_GATEWAY_TOKEN=' "$WEB_ENV" 2>/dev/null; then
    sed -i "s|^OPENCLAW_GATEWAY_TOKEN=.*|OPENCLAW_GATEWAY_TOKEN=${GW_TOKEN}|" "$WEB_ENV"
  else
    echo "OPENCLAW_GATEWAY_TOKEN=${GW_TOKEN}" >>"$WEB_ENV"
  fi
  if grep -q '^OPENCLAW_CONSOLE_URL=' "$WEB_ENV" 2>/dev/null; then
    sed -i "s|^OPENCLAW_CONSOLE_URL=.*|OPENCLAW_CONSOLE_URL=${ORIGIN}${BASE_PATH}/|" "$WEB_ENV"
  else
    echo "OPENCLAW_CONSOLE_URL=${ORIGIN}${BASE_PATH}/" >>"$WEB_ENV"
  fi
  log "synced OPENCLAW_* into web/.env"
fi

node - "$CONFIG" "$ORIGIN" "$BASE_PATH" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const origin = process.argv[3];
const basePath = process.argv[4];
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.gateway = cfg.gateway || {};
cfg.gateway.controlUi = {
  ...(cfg.gateway.controlUi || {}),
  enabled: true,
  basePath,
  allowedOrigins: [origin],
};
if (!cfg.gateway.auth?.token) {
  console.error("gateway.auth.token missing — set in openclaw.json first");
  process.exit(1);
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log(`controlUi: enabled basePath=${basePath} allowedOrigins=[${origin}]`);
NODE

pm2 restart aichart-web --update-env 2>/dev/null || true
pm2 stop aichart-agent || true
sleep 4
pm2 start aichart-agent --update-env
sleep 6
log "gateway should serve Control UI at ${ORIGIN}${BASE_PATH}/"
pm2 list | grep -E 'aichart-agent|aichart-web' || true
