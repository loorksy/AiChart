#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart/web
node --input-type=module <<'NODE'
import pg from "pg";
import fs from "fs";
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\n/).filter((l) => l && !l.startsWith("#")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
await pool.query("UPDATE platform_config SET value='claude-sonnet-4-6' WHERE key='AI_MODEL'");
const { rows } = await pool.query("SELECT key,value FROM platform_config WHERE key='AI_MODEL'");
await pool.end();
console.log("updated", rows[0]);
NODE
export AICHART_API_URL=http://127.0.0.1:3010
set -a; source .env; set +a
bash /opt/aichart/agent/scripts/sync-model.sh
pm2 restart aichart-agent --update-env
openclaw config get agents.defaults.model.primary
