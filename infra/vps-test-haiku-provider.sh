#!/usr/bin/env bash
set -euo pipefail
pm2 stop aichart-agent 2>/dev/null || true
sleep 3
node - <<'NODE'
const fs = require("fs");
const p = "/root/.openclaw/openclaw.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const id = "claude-haiku-4-5-20251001";
const ref = `anthropic/${id}`;
c.agents ??= {};
c.agents.defaults ??= {};
c.agents.defaults.model = { primary: ref };
c.agents.defaults.models ??= {};
c.agents.defaults.models[ref] = {
  params: { cacheRetention: "long", thinking: "off" },
};
c.agents.defaults.thinkingDefault = "off";
c.models = {
  providers: {
    anthropic: {
      models: [{ id, name: id }],
    },
  },
};
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
console.log("patched", ref);
NODE
openclaw config validate
pm2 restart aichart-agent --update-env
sleep 8
openclaw agent --channel telegram --session-key agent:main:telegram:direct:5969744996 --message ping --thinking off --json 2>&1 | tail -10
