#!/usr/bin/env bash
# Re-apply AiChart OpenClaw config lost after doctor restore.
set -euo pipefail
CONFIG="/root/.openclaw/openclaw.json"
ENV_FILE="/root/.openclaw/.env"
WEB_ENV="/opt/aichart/web/.env"

PORT="$(grep '^PORT=' "$WEB_ENV" 2>/dev/null | cut -d= -f2- || echo 3010)"
SVC="$(grep '^AICHART_SERVICE_TOKEN=' "$WEB_ENV" 2>/dev/null | cut -d= -f2- || true)"
mkdir -p /root/.openclaw
touch "$ENV_FILE"
upsert() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    echo "${k}=${v}" >>"$ENV_FILE"
  fi
}
upsert "AICHART_API_URL" "http://127.0.0.1:${PORT}"
[[ -n "$SVC" ]] && upsert "AICHART_SERVICE_TOKEN" "$SVC"

node - "$CONFIG" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch { cfg = {}; }
const patch = {
  agents: {
    defaults: {
      contextPruning: { mode: "cache-ttl" },
      heartbeat: { every: "15m", target: "last", isolatedSession: true },
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
// Preserve exec no-approval if already disabled (Telegram timeout workaround).
const execAsk = cfg.tools?.exec?.ask;
const execSecurity = cfg.tools?.exec?.security;
deepMerge(cfg, patch);
if (execAsk === "off" || execSecurity === "full") {
  cfg.tools ??= {};
  cfg.tools.exec = {
    ...(cfg.tools.exec ?? {}),
    ask: execAsk ?? cfg.tools.exec?.ask,
    security: execSecurity ?? cfg.tools.exec?.security,
  };
  console.log("preserved tools.exec ask/security (no-approval mode)");
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("merged AiChart openclaw defaults");
NODE

# Pre-allow curl + wget for bridge API and chart images
node - <<'NODE'
const fs = require("fs");
const path = "/root/.openclaw/exec-approvals.json";
let cfg = { version: 1, defaults: { security: "allowlist", ask: "on-miss", askFallback: "deny" }, agents: { main: { allowlist: [] } } };
try { cfg = JSON.parse(fs.readFileSync(path, "utf8")); } catch {}
cfg.agents ??= {};
cfg.agents.main ??= {};
cfg.agents.main.allowlist ??= [];
const patterns = ["/usr/bin/curl", "/bin/curl", "/usr/bin/wget", "/bin/wget"];
for (const p of patterns) {
  if (!cfg.agents.main.allowlist.some((e) => e.pattern === p)) {
    cfg.agents.main.allowlist.push({ id: require("crypto").randomUUID(), pattern: p, source: "allow-always" });
  }
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("curl/wget allow-always in exec-approvals");
NODE

pm2 stop aichart-agent && sleep 4 && pm2 start aichart-agent --update-env
sleep 6
pm2 list | grep aichart-agent
echo "done - try: ارسل صورة الشارت"
