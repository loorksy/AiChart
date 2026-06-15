#!/usr/bin/env bash
# Syncs the OpenClaw primary model from the provider + model chosen in the
# AiChart admin panel (AI_PROVIDER / AI_MODEL), including cross-provider
# fallbacks and OpenAI-compatible provider credentials.
# Run after changing the model in the dashboard, then restart the gateway.
set -euo pipefail

WEB_DIR="${WEB_DIR:-/opt/aichart/web}"
if [[ -z "${AICHART_SERVICE_TOKEN:-}" && -f "$WEB_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$WEB_DIR/.env"
  set +a
fi

API="${AICHART_API_URL:-http://127.0.0.1:${PORT:-3010}}"
TOKEN="${AICHART_SERVICE_TOKEN:?AICHART_SERVICE_TOKEN غير معرّف في البيئة}"
CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

if [[ "${OPENCLAW_ENABLED:-1}" == "0" ]]; then
  echo "OpenClaw معطّل (OPENCLAW_ENABLED=0) — تخطّي sync-model"
  exit 0
fi

PAYLOAD="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/agent/model")"

if [ -z "$PAYLOAD" ]; then
  echo "تعذّر جلب النموذج من $API/api/agent/model" >&2
  exit 1
fi

if [[ "${OPENCLAW_AUTO_RESTART:-}" == "1" ]]; then
  pm2 stop aichart-agent 2>/dev/null || true
  sleep 3
fi

node - "$CONFIG" "$PAYLOAD" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" <<'EOF'
const fs = require("fs");
const path = require("path");
const [, , configPath, payloadJson, scriptDir] = process.argv;

let payload;
try {
  payload = JSON.parse(payloadJson);
} catch (e) {
  console.error(`رد غير صالح من /api/agent/model: ${e.message}`);
  process.exit(1);
}

const ref = payload.ref;
const fallbacks = (Array.isArray(payload.fallbacks) ? payload.fallbacks : []).filter(
  (f) => typeof f === "string" && !f.toLowerCase().includes("openrouter") && !f.includes("-tts"),
);
const providerKeys =
  payload.providerKeys && typeof payload.providerKeys === "object"
    ? payload.providerKeys
    : {};

if (!ref || ref.toLowerCase().includes("openrouter") || ref.includes("-tts")) {
  console.error(`ref غير صالح من /api/agent/model: ${ref}`);
  process.exit(1);
}

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(
    `تعذّر قراءة ${configPath} (ربما يحوي تعليقات JSON5؟) — عدّل يدوياً:\n` +
      `  agents.defaults.model.primary = "${ref}"\n` +
      `السبب: ${e.message}`,
  );
  process.exit(1);
}

cfg.agents ??= {};
cfg.agents.defaults ??= {};
delete cfg.agents.defaults.thinking;

// Rate-limit resilience: cross-provider fallbacks (built server-side from
// the providers whose API keys are configured in the admin panel).
const model = cfg.agents.defaults.model;
cfg.agents.defaults.model =
  model && typeof model === "object"
    ? { ...model, primary: ref, fallbacks }
    : { primary: ref, fallbacks };
if (cfg.agents.defaults.model && typeof cfg.agents.defaults.model === "object") {
  delete cfg.agents.defaults.model.thinking;
}
cfg.agents.defaults.thinkingDefault = "off";
delete cfg.agents.defaults.contextPruning;
delete cfg.agents.defaults.heartbeat;

const tokenParams = {
  cacheRetention: "long",
  thinking: "off",
  maxTokens: 16384,
};
cfg.agents.defaults.models = {};
const activeRefs = [ref, ...fallbacks];
for (const full of activeRefs) {
  const entry = { params: tokenParams };
  if (full === ref) {
    const slash = ref.indexOf("/");
    entry.alias = slash >= 0 ? ref.slice(slash + 1) : ref;
  }
  cfg.agents.defaults.models[full] = entry;
}

function applyOpenAiCompatProvider(provider, merged, providerKeys) {
  const urls = {
    openai: "https://api.openai.com/v1",
    google: "https://generativelanguage.googleapis.com/v1beta/openai",
  };
  const baseUrl = urls[provider];
  if (!baseUrl) return;
  const key = providerKeys[provider];
  if (key) merged.apiKey = key;
  merged.baseUrl = baseUrl;
  merged.api = "openai-completions";
}
const idsByProvider = new Map();
for (const full of activeRefs) {
  const slash = full.indexOf("/");
  const provider = slash >= 0 ? full.slice(0, slash) : "anthropic";
  const modelId = slash >= 0 ? full.slice(slash + 1) : full;
  if (!idsByProvider.has(provider)) idsByProvider.set(provider, new Set());
  idsByProvider.get(provider).add(modelId);
}

cfg.models ??= {};
cfg.models.providers ??= {};
for (const [provider, allowedIds] of idsByProvider) {
  const bucket = cfg.models.providers[provider] ?? { models: [] };
  const models = [...allowedIds].map((id) => {
    const existing = (bucket.models ?? []).find((m) => m.id === id);
    return existing?.name ? existing : { id, name: id };
  });
  const merged = { ...bucket, models };
  applyOpenAiCompatProvider(provider, merged, providerKeys);
  if (provider === "anthropic") {
    merged.api = merged.api || "anthropic-messages";
  }
  cfg.models.providers[provider] = merged;
}

for (const provider of Object.keys(cfg.models.providers)) {
  if (!idsByProvider.has(provider)) {
    delete cfg.models.providers[provider];
  }
}

const arPath = path.join(scriptDir || ".", "../../web/src/lib/telegram-ar-commands.json");
let customCommands = [];
try {
  customCommands = JSON.parse(fs.readFileSync(arPath, "utf8")).botCommands || [];
} catch {
  customCommands = [
    { command: "qaima", description: "القائمة الرئيسية" },
    { command: "tahil", description: "تحليل زوج" },
    { command: "rased", description: "الرصيد والمحفظة" },
    { command: "safaqat", description: "الصفقات المفتوحة" },
    { command: "iadadat", description: "الإعدادات والوضع الحالي" },
    { command: "crypto", description: "السوق: كربتو" },
    { command: "forex", description: "السوق: فوركس" },
    { command: "demo", description: "تفعيل وضع الديمو" },
    { command: "live", description: "تفعيل الوضع الحقيقي" },
  ];
}
cfg.channels ??= {};
cfg.channels.telegram = {
  ...(cfg.channels.telegram && typeof cfg.channels.telegram === "object"
    ? cfg.channels.telegram
    : {}),
  enabled: cfg.channels.telegram?.enabled ?? true,
  dmPolicy: cfg.channels.telegram?.dmPolicy ?? "open",
  commands: { native: false, nativeSkills: false },
  customCommands,
  capabilities: {
    ...(cfg.channels.telegram?.capabilities ?? {}),
    inlineButtons: cfg.channels.telegram?.capabilities?.inlineButtons ?? "dm",
  },
};

fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
console.log(
  `primary model → ${ref} (fallbacks: ${fallbacks.join(", ") || "none"})`,
);
EOF

if [[ "${OPENCLAW_AUTO_RESTART:-}" == "1" ]]; then
  pm2 restart aichart-agent --update-env 2>/dev/null || pm2 start aichart-agent --update-env 2>/dev/null || true
  sleep 5
  echo "أُعيد تشغيل aichart-agent"
else
  echo "أعد تشغيل البوابة لتطبيق النموذج:"
  echo "  pm2 stop aichart-agent && sleep 3 && pm2 start aichart-agent --update-env"
fi
