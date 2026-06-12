#!/usr/bin/env bash
# One-shot: register current primary in models.providers + restart gateway.
set -euo pipefail
CONFIG="${OPENCLAW_CONFIG:-/root/.openclaw/openclaw.json}"
node - "$CONFIG" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
const ref = cfg.agents?.defaults?.model?.primary;
if (!ref) {
  console.error("no primary model in config");
  process.exit(1);
}
const slash = ref.indexOf("/");
const provider = slash >= 0 ? ref.slice(0, slash) : "anthropic";
const id = slash >= 0 ? ref.slice(slash + 1) : ref;
cfg.models ??= {};
cfg.models.providers ??= {};
const bucket = cfg.models.providers[provider] ?? { models: [] };
const models = [...(bucket.models ?? [])];
if (!models.some((m) => m.id === id)) models.push({ id, name: id });
cfg.models.providers[provider] = { ...bucket, models };
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("registered", provider, id);
NODE
pm2 restart aichart-agent --update-env
sleep 5
echo "done"
