#!/usr/bin/env bash
# AiChart VPS update — touches only /opt/aichart and ~/.openclaw
set -euo pipefail

INSTALL_DIR="/opt/aichart"
WEB_DIR="$INSTALL_DIR/web"
ENV_FILE="$WEB_DIR/.env"
OPENCLAW_DIR="$HOME/.openclaw"
OPENCLAW_JSON="$OPENCLAW_DIR/openclaw.json"
EXEC_APPROVALS="$OPENCLAW_DIR/exec-approvals.json"
OPENCLAW_ENV="$OPENCLAW_DIR/.env"

log() { echo "[aichart-deploy] $*"; }

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

# ── 1) pull + build ──────────────────────────────────────────────
log "Step 1: git pull + build"
cd "$INSTALL_DIR"
git fetch origin
git checkout main
git pull --ff-only origin main
log "At commit: $(git log --oneline -1)"
cd "$WEB_DIR"
npm ci
npm run build

# ── 2) web/.env ──────────────────────────────────────────────────
log "Step 2: update web/.env"
upsert_env "AICHART_SINGLE_USER" "1"
upsert_env "AICHART_GATE_PASSWORD" "Ahmetlork0009"
if ! grep -q "^AICHART_SERVICE_TOKEN=" "$ENV_FILE" 2>/dev/null || [ -z "$(grep '^AICHART_SERVICE_TOKEN=' "$ENV_FILE" | cut -d= -f2-)" ]; then
  TOKEN="$(openssl rand -hex 32)"
  upsert_env "AICHART_SERVICE_TOKEN" "$TOKEN"
  log "Generated new AICHART_SERVICE_TOKEN"
fi

set -a
# shellcheck disable=SC1090
source <(grep -E '^(PORT|AICHART_SERVICE_TOKEN)=' "$ENV_FILE" | sed 's/^/export /')
set +a
PORT="${PORT:-3010}"
API_URL="http://127.0.0.1:${PORT}"
export AICHART_API_URL="$API_URL"
export AICHART_SERVICE_TOKEN

log "Restarting aichart-web..."
pm2 restart aichart-web --update-env

# ── 3) sync workspace ────────────────────────────────────────────
log "Step 3: sync-workspace"
bash "$INSTALL_DIR/agent/scripts/sync-workspace.sh"

# ── 4) merge openclaw.json ───────────────────────────────────────
log "Step 4: merge openclaw.json"
node - "$OPENCLAW_JSON" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const patch = {
  agents: {
    defaults: {
      contextPruning: { mode: "cache-ttl" },
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
              'curl -sf -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" -F "file=@$1" "${AICHART_API_URL:-http://localhost:3000}/api/agent/transcribe"',
              "_",
              "{{MediaPath}}",
            ],
            timeoutSeconds: 90,
          },
        ],
      },
    },
  },
};

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (e) {
  console.error("Failed to read openclaw.json:", e.message);
  process.exit(1);
}
deepMerge(cfg, patch);
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("openclaw.json merged");
NODE

# OpenClaw env for gateway
mkdir -p "$OPENCLAW_DIR"
touch "$OPENCLAW_ENV"
for kv in "AICHART_API_URL=$API_URL" "AICHART_SERVICE_TOKEN=$AICHART_SERVICE_TOKEN"; do
  k="${kv%%=*}"
  v="${kv#*=}"
  if grep -q "^${k}=" "$OPENCLAW_ENV" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$OPENCLAW_ENV"
  else
    echo "${k}=${v}" >>"$OPENCLAW_ENV"
  fi
done
log "Updated $OPENCLAW_ENV"

# ── 5) exec-approvals.json ───────────────────────────────────────
log "Step 5: exec-approvals.json"
node - "$EXEC_APPROVALS" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const defaults = {
  security: "allowlist",
  ask: "on-miss",
  askFallback: "deny",
};
let cfg = { version: 1, defaults };
try {
  if (fs.existsSync(path)) {
    cfg = JSON.parse(fs.readFileSync(path, "utf8"));
    cfg.defaults = { ...(cfg.defaults ?? {}), ...defaults };
    cfg.version ??= 1;
  }
} catch {
  /* fresh file */
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("exec-approvals.json ready");
NODE

# ── 6) sync model ────────────────────────────────────────────────
log "Step 6: sync-model"
bash "$INSTALL_DIR/agent/scripts/sync-model.sh"

# ── 7) restart agent (stop/start) ────────────────────────────────
log "Step 7: stop/start aichart-agent"
pm2 stop aichart-agent
sleep 5
pm2 start aichart-agent --update-env
pm2 save

log "Step 8: verification"
echo "=== risk/status (port $PORT) ==="
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$API_URL/api/agent/risk/status" | head -c 200
echo ""
echo "=== agent/model ==="
curl -s -H "Authorization: Bearer $AICHART_SERVICE_TOKEN" "$API_URL/api/agent/model"
echo ""
echo "=== login wrong password (expect 401) ==="
curl -s -o /tmp/login-test.json -w "HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"password":"wrong"}' "$API_URL/api/auth/login"
head -c 200 /tmp/login-test.json 2>/dev/null || true
echo ""
echo "=== pm2 logs aichart-agent (30 lines) ==="
pm2 logs aichart-agent --lines 30 --nostream 2>&1 | tail -35
echo "=== pm2 logs aichart-web (20 lines) ==="
pm2 logs aichart-web --lines 20 --nostream 2>&1 | tail -25
echo "=== done at $(git -C $INSTALL_DIR log --oneline -1) ==="
