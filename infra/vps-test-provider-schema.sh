#!/usr/bin/env bash
set -euo pipefail
CONFIG="/root/.openclaw/openclaw.json"
cp "$CONFIG" /tmp/oc-test.json
node - /tmp/oc-test.json <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
const ref = "anthropic/claude-haiku-4-5-20251001";
const id = "claude-haiku-4-5-20251001";
cfg.models = {
  providers: {
    anthropic: {
      models: [{ id, name: id }],
    },
  },
};
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
NODE
OPENCLAW_CONFIG=/tmp/oc-test.json openclaw config validate 2>&1 || true
