#!/usr/bin/env bash
set -euo pipefail
CONFIG="/root/.openclaw/openclaw.json"
BACKUP="$(ls -t /root/.openclaw/openclaw.json.bak* 2>/dev/null | head -1 || true)"

if [[ -n "$BACKUP" && -f "$BACKUP" ]]; then
  echo "[repair] restore from $BACKUP"
  cp "$BACKUP" "$CONFIG"
else
  echo "[repair] no .bak - patch current config"
fi

node - "$CONFIG" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.agents ??= {};
cfg.agents.defaults ??= {};
delete cfg.agents.defaults.thinking;
if (cfg.agents.defaults.model && typeof cfg.agents.defaults.model === "object") {
  delete cfg.agents.defaults.model.thinking;
  if (!cfg.agents.defaults.model.primary) {
    cfg.agents.defaults.model.primary = "anthropic/claude-sonnet-4-6";
  }
} else if (!cfg.agents.defaults.model) {
  cfg.agents.defaults.model = { primary: "anthropic/claude-sonnet-4-6" };
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("model.primary =", cfg.agents.defaults.model.primary || cfg.agents.defaults.model);
NODE

openclaw doctor --fix 2>/dev/null || true
pm2 stop aichart-agent || true
sleep 2
set -a
source /root/.openclaw/.env 2>/dev/null || true
source /opt/aichart/web/.env 2>/dev/null || true
set +a
export AICHART_API_URL="${AICHART_API_URL:-http://127.0.0.1:3010}"
pm2 restart aichart-agent --update-env || pm2 start openclaw --name aichart-agent -- gateway
sleep 8
pm2 list | grep aichart-agent || true
echo "--- errors ---"
tail -5 /root/.pm2/logs/aichart-agent-error.log 2>/dev/null || true
echo "--- out ---"
tail -8 /root/.pm2/logs/aichart-agent-out.log 2>/dev/null || true
