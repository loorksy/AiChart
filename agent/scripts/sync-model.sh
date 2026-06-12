#!/usr/bin/env bash
# Syncs the OpenClaw primary model from the provider + model chosen in the
# AiChart admin panel (AI_PROVIDER / AI_MODEL), including cross-provider
# fallbacks and OpenAI-compatible provider credentials.
# Run after changing the model in the dashboard, then restart the gateway.
set -euo pipefail

API="${AICHART_API_URL:-http://localhost:3000}"
TOKEN="${AICHART_SERVICE_TOKEN:?AICHART_SERVICE_TOKEN غير معرّف في البيئة}"
CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

PAYLOAD="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/agent/model")"

if [ -z "$PAYLOAD" ]; then
  echo "تعذّر جلب النموذج من $API/api/agent/model" >&2
  exit 1
fi

if [[ "${OPENCLAW_AUTO_RESTART:-}" == "1" ]]; then
  pm2 stop aichart-agent 2>/dev/null || true
  sleep 3
fi

node - "$CONFIG" "$PAYLOAD" <<'EOF'
const fs = require("fs");
const [, , path, payloadJson] = process.argv;

let payload;
try {
  payload = JSON.parse(payloadJson);
} catch (e) {
  console.error(`رد غير صالح من /api/agent/model: ${e.message}`);
  process.exit(1);
}

const ref = payload.ref;
const fallbacks = Array.isArray(payload.fallbacks) ? payload.fallbacks : [];
const providerKeys =
  payload.providerKeys && typeof payload.providerKeys === "object"
    ? payload.providerKeys
    : {};

if (!ref) {
  console.error("لا يوجد ref في رد /api/agent/model");
  process.exit(1);
}

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (e) {
  console.error(
    `تعذّر قراءة ${path} (ربما يحوي تعليقات JSON5؟) — عدّل يدوياً:\n` +
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

// Token savings: isolated heartbeat session (~2-5K tokens instead of full
// conversation history) + prune stale tool outputs once the cache TTL expires.
const hb = cfg.agents.defaults.heartbeat;
cfg.agents.defaults.heartbeat = {
  ...(hb && typeof hb === "object" ? hb : {}),
  isolatedSession: true,
};
cfg.agents.defaults.contextPruning = {
  ...(typeof cfg.agents.defaults.contextPruning === "object"
    ? cfg.agents.defaults.contextPruning
    : {}),
  mode: "cache-ttl",
};

cfg.agents.defaults.models ??= {};
const entry = cfg.agents.defaults.models[ref] ?? {};
cfg.agents.defaults.models[ref] = {
  ...entry,
  params: {
    ...(entry.params ?? {}),
    // cacheRetention applies to Anthropic; harmless for other providers.
    cacheRetention: "long",
    thinking: "off",
  },
};

// Register primary + fallbacks in models.providers so OpenClaw accepts them,
// and attach credentials/baseUrl for OpenAI-compatible providers.
const PROVIDER_BASE_URL = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};
cfg.models ??= {};
cfg.models.providers ??= {};
for (const full of [ref, ...fallbacks]) {
  const slash = full.indexOf("/");
  const provider = slash >= 0 ? full.slice(0, slash) : "anthropic";
  const modelId = slash >= 0 ? full.slice(slash + 1) : full;
  const bucket = cfg.models.providers[provider] ?? { models: [] };
  const provModels = [...(bucket.models ?? [])];
  if (!provModels.some((m) => m.id === modelId)) {
    provModels.push({ id: modelId, name: modelId });
  }
  const merged = { ...bucket, models: provModels };
  if (provider === "openrouter" || provider === "openai") {
    if (providerKeys[provider]) merged.apiKey = providerKeys[provider];
    merged.baseUrl = PROVIDER_BASE_URL[provider];
    merged.api = "openai-completions";
  }
  cfg.models.providers[provider] = merged;
}

fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
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
