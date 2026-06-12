#!/usr/bin/env bash
# Syncs the OpenClaw primary model from the model chosen in the AiChart
# admin panel (ANTHROPIC_MODEL), and keeps cacheRetention: "long" on it.
# Run after changing the model in the dashboard, then restart the gateway.
set -euo pipefail

API="${AICHART_API_URL:-http://localhost:3000}"
TOKEN="${AICHART_SERVICE_TOKEN:?AICHART_SERVICE_TOKEN غير معرّف في البيئة}"
CONFIG="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

REF="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/agent/model" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).ref')"

if [ -z "$REF" ]; then
  echo "تعذّر جلب النموذج من $API/api/agent/model" >&2
  exit 1
fi

if [[ "${OPENCLAW_AUTO_RESTART:-}" == "1" ]]; then
  pm2 stop aichart-agent 2>/dev/null || true
  sleep 3
fi

node - "$CONFIG" "$REF" <<'EOF'
const fs = require("fs");
const [, , path, ref] = process.argv;
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
const model = cfg.agents.defaults.model;
cfg.agents.defaults.model =
  model && typeof model === "object"
    ? { ...model, primary: ref }
    : { primary: ref };
if (cfg.agents.defaults.model && typeof cfg.agents.defaults.model === "object") {
  delete cfg.agents.defaults.model.thinking;
}
cfg.agents.defaults.thinkingDefault = "off";
cfg.agents.defaults.contextPruning = { mode: "cache-ttl" };
delete cfg.agents.defaults.heartbeat;

cfg.agents.defaults.models ??= {};
const entry = cfg.agents.defaults.models[ref] ?? {};
cfg.agents.defaults.models[ref] = {
  ...entry,
  params: {
    ...(entry.params ?? {}),
    cacheRetention: "long",
    thinking: "off",
  },
};

// Register in models.providers so OpenClaw accepts new Anthropic model ids.
const slash = ref.indexOf("/");
const provider = slash >= 0 ? ref.slice(0, slash) : "anthropic";
const modelId = slash >= 0 ? ref.slice(slash + 1) : ref;
cfg.models ??= {};
cfg.models.providers ??= {};
const bucket = cfg.models.providers[provider] ?? { models: [] };
const provModels = [...(bucket.models ?? [])];
if (!provModels.some((m) => m.id === modelId)) {
  provModels.push({ id: modelId, name: modelId });
}
cfg.models.providers[provider] = { ...bucket, models: provModels };

fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log(`primary model → ${ref} (provider registered)`);
EOF

if [[ "${OPENCLAW_AUTO_RESTART:-}" == "1" ]]; then
  pm2 restart aichart-agent --update-env 2>/dev/null || pm2 start aichart-agent --update-env 2>/dev/null || true
  sleep 5
  echo "أُعيد تشغيل aichart-agent"
else
  echo "أعد تشغيل البوابة لتطبيق النموذج:"
  echo "  pm2 stop aichart-agent && sleep 3 && pm2 start aichart-agent --update-env"
fi
