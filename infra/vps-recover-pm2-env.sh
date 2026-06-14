#!/usr/bin/env bash
node <<'NODE'
const fs = require("fs");
const raw = fs.readFileSync("/root/.pm2/dump.pm2", "utf8");
let d;
try { d = JSON.parse(raw); } catch { d = require("/root/.pm2/dump.pm2"); }
const apps = Array.isArray(d) ? d : d.apps || [];
for (const a of apps) {
  if (!(a.name || "").includes("aichart")) continue;
  const env = a.pm2_env?.env || {};
  console.log("=== " + a.name + " ===");
  for (const k of ["DATABASE_URL","ENCRYPTION_KEY","APP_SECRET","CRON_SECRET","AICHART_SERVICE_TOKEN","PORT","APP_URL","AICHART_GATE_PASSWORD"]) {
    if (env[k]) console.log(k + "=" + env[k]);
  }
}
NODE
grep -oE 'ENCRYPTION_KEY=[a-f0-9]{64}|DATABASE_URL=postgresql[^ ]+' /root/.pm2/dump.pm2 2>/dev/null | head -10
strings /root/.pm2/dump.pm2 | grep -E 'ENCRYPTION_KEY|DATABASE_URL' | head -10
