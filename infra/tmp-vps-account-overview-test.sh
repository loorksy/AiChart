#!/usr/bin/env bash
set -euo pipefail
cd /opt/aichart
set -a
source web/.env
set +a
PORT="${PORT:-3010}"
EMAIL="${ADMIN_EMAIL:?}"
SIG=$(node -e "const c=require('crypto');console.log(c.createHmac('sha256',process.env.AICHART_SERVICE_TOKEN).update(process.argv[1].toLowerCase()).digest('hex'))" "$EMAIL")

echo "=== Bridge endpoints (account overview parts) ==="
for path in risk/status portfolio live/account; do
  HTTP=$(curl -sS -o "/tmp/${path//\//-}.json" -w "%{http_code}" \
    -H "Authorization: Bearer ${AICHART_SERVICE_TOKEN}" \
    -H "X-Aichart-User-Email: ${EMAIL}" \
    -H "X-Aichart-User-Sig: ${SIG}" \
    "http://127.0.0.1:${PORT}/api/agent/${path}")
  echo "${path} HTTP=${HTTP}"
done

echo ""
echo "=== Simulated widget field extraction ==="
node --input-type=module <<'NODE'
import fs from "fs";
import { createHmac } from "crypto";

function obj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function unwrapBridge(v) {
  v = obj(v);
  if (v.ok === true && v.data != null && typeof v.data === "object") return v.data;
  return v;
}
function first(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}

const riskRaw = JSON.parse(fs.readFileSync("/tmp/risk-status.json", "utf8"));
const portfolio = JSON.parse(fs.readFileSync("/tmp/portfolio.json", "utf8"));
const liveRaw = JSON.parse(fs.readFileSync("/tmp/live-account.json", "utf8"));

const overview = {
  risk: unwrapBridge(riskRaw),
  portfolio,
  live: liveRaw.ok === true && liveRaw.data ? liveRaw.data : liveRaw,
};

const risk = obj(overview.risk);
const live = obj(overview.live);
const pf = obj(overview.portfolio);
const cap = obj(risk.capital);
const eaLive = obj(obj(live.forex).ea);
const eaPort = obj(obj(pf.forex).ea);

console.log({
  balance: first(eaLive.balance, eaPort.balance),
  equity: first(eaLive.equity, eaPort.equity),
  perTradeMaxUsd: first(cap.perTradeMaxUsd),
  effectiveCapital: first(cap.effectiveCapital),
  openTrades: Array.isArray(live.openTrades) ? live.openTrades.length : Array.isArray(pf.openTrades) ? pf.openTrades.length : 0,
  eaOnline: first(eaLive.online, eaPort.online),
});
NODE

echo ""
echo "=== MCP build has unwrapBridgePayload ==="
grep -n "unwrapBridgePayload" mcp/src/bridge/client.ts | head -2

echo "ACCOUNT OVERVIEW VPS TEST DONE"
