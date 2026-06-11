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
const model = cfg.agents.defaults.model;
cfg.agents.defaults.model =
  model && typeof model === "object"
    ? { ...model, primary: ref }
    : { primary: ref };

// Keep the 1-hour prompt cache on the selected model.
cfg.agents.defaults.models ??= {};
const entry = cfg.agents.defaults.models[ref] ?? {};
cfg.agents.defaults.models[ref] = {
  ...entry,
  params: { ...(entry.params ?? {}), cacheRetention: "long" },
};

fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log(`primary model → ${ref}`);
EOF

echo "أعد تشغيل البوابة لتطبيق النموذج:"
echo "  pm2 stop aichart-agent && sleep 5 && pm2 start aichart-agent"
