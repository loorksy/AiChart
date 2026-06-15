#!/usr/bin/env bash
# Fix: reset model to sonnet, ensure telegram spool, restart agent, test delivery.
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/aichart}"

echo "[fix] reset primary model to sonnet (was opus)"
openclaw config set agents.defaults.model.primary anthropic/claude-sonnet-4-5-20250929
openclaw config set models.providers.anthropic.api anthropic-messages

echo "[fix] sync anthropic auth from platform"
bash "$INSTALL_DIR/agent/scripts/sync-openclaw-auth.sh" anthropic

echo "[fix] ensure telegram ingress spool dir"
mkdir -p /root/.openclaw/telegram/ingress-spool-default

echo "[fix] platform AI_MODEL"
cd "$INSTALL_DIR/web"
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
const { rows } = await pool.query(
  "SELECT key, value FROM platform_config WHERE key IN ('AI_MODEL','AI_PROVIDER')",
);
await pool.end();
console.log(JSON.stringify(rows));
NODE

echo "[fix] restart agent"
pm2 restart aichart-agent --update-env
sleep 8

echo "[fix] test delivery"
openclaw agent --channel telegram --deliver --to 5969744996 --message "اختبار بعد الإصلاح — أرسل مرحبا الآن" 2>&1 | tail -8

echo "[fix] current model:"
openclaw config get agents.defaults.model.primary
