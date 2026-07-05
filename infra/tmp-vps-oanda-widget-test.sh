#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart

echo "=== 1) forexSymbol module ==="
node --input-type=module <<'NODE'
import { toOandaForexSymbol, isBrokerForexSuffix } from "./mcp/dist/lib/forexSymbol.js";
for (const s of ["XAUUSDM", "EURUSDm", "XAUUSD", "EURUSD"]) {
  console.log(`${s} -> ${toOandaForexSymbol(s)} broker=${isBrokerForexSuffix(s)}`);
}
NODE

echo ""
echo "=== 2) OANDA direct smoke ==="
cd /opt/aichart/web
node scripts/vps-test-oanda.mjs

echo ""
echo "=== 3) widget oandaSym present ==="
grep -c "function oandaSym" /opt/aichart/mcp/src/ui/widgets.ts

echo ""
echo "=== 4) env + bridge/public API ==="
set -a
source /opt/aichart/web/.env
set +a
PORT="${PORT:-3010}"
TOKEN="${AICHART_SERVICE_TOKEN:?missing token}"

HTTP=$(curl -sS -o /tmp/ohlc-err.json -w "%{http_code}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Aichart-User-Email: ${ADMIN_EMAIL}" \
  "http://127.0.0.1:${PORT}/api/agent/market/ohlc?symbol=XAUUSDM&interval=15m&market=forex&source=oanda&limit=5")
echo "XAUUSDM bridge HTTP=${HTTP} body=$(head -c 200 /tmp/ohlc-err.json)"

echo ""
echo "=== 4b) Widget symbol normalize (JS) ==="
node -e "function o(s){s=String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');return s.length>=6?s.slice(0,6):s;} console.log('XAUUSDM->'+o('XAUUSDM'));"

echo ""
echo "=== 5) Public klines ==="
for SYM in XAUUSDM XAUUSD; do
  HTTP=$(curl -sS -o /tmp/kl.json -w "%{http_code}" \
    "http://127.0.0.1:${PORT}/api/market/klines?symbol=${SYM}&interval=15m&market=forex&limit=5")
  node -e "
    const j=require('/tmp/kl.json');
    console.log('${SYM} HTTP=${HTTP} candles='+(j.candles||[]).length+' source='+(j.source||'?'));
  "
done

echo ""
echo "=== 6) MCP health ==="
curl -sf "http://127.0.0.1:8787/health"
echo ""

echo ""
echo "=== 7) chart_layouts ==="
node --input-type=module <<'NODE'
import fs from "fs";
import pg from "pg";
const env = fs.readFileSync("/opt/aichart/web/.env", "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1];
const c = new pg.Client({ connectionString: dbUrl });
await c.connect();
const r = await c.query("SELECT id, symbol FROM chart_layouts ORDER BY updated_at DESC NULLS LAST LIMIT 5");
for (const row of r.rows) console.log(row.id, row.symbol);
await c.end();
NODE

echo ""
echo "=== 8) forex-price XAUUSDM ==="
curl -sS "http://127.0.0.1:${PORT}/api/market/forex-price?symbol=XAUUSDM" | head -c 180
echo ""

echo ""
echo "=== 9) draw_on_chart symbol in MCP build ==="
grep -n "toOandaForexSymbol" /opt/aichart/mcp/src/tools/charts.ts | head -3

echo ""
