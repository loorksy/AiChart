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
cfg.agents.defaults.contextPruning = { mode: "cache-ttl" };
delete cfg.agents.defaults.heartbeat;

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

cfg.agents.defaults.models = {};
const tokenParams = {
  cacheRetention: "long",
  thinking: "off",
  maxTokens: 1024,
};
const activeRefs = [ref, ...fallbacks];
for (const full of activeRefs) {
  cfg.agents.defaults.models[full] = { params: tokenParams };
}

// Register primary + fallbacks in models.providers so OpenClaw accepts them,
// and attach credentials/baseUrl for OpenAI-compatible providers.
const PROVIDER_BASE_URL = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};
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
  if (provider === "openrouter" || provider === "openai") {
    if (providerKeys[provider]) merged.apiKey = providerKeys[provider];
    merged.baseUrl = PROVIDER_BASE_URL[provider];
    merged.api = "openai-completions";
  } else if (provider === "google") {
    if (providerKeys.google) merged.apiKey = providerKeys.google;
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
