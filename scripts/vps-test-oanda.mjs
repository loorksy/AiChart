import fs from "fs";
process.chdir("/opt/aichart/web");
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const token = process.env.OANDA_API_TOKEN;
const acct = process.env.OANDA_ACCOUNT_ID;
const base = "https://api-fxpractice.oanda.com";
const h = { Authorization: `Bearer ${token}` };

const [cRes, pRes] = await Promise.all([
  fetch(`${base}/v3/instruments/EUR_USD/candles?granularity=H1&count=3&price=M`, { headers: h }),
  fetch(`${base}/v3/accounts/${acct}/pricing?instruments=EUR_USD`, { headers: h }),
]);
const c = await cRes.json();
const p = await pRes.json();
console.log(
  JSON.stringify(
    {
      candles_status: cRes.status,
      candles_count: c.candles?.length ?? 0,
      pricing_status: pRes.status,
      bid: p.prices?.[0]?.bids?.[0]?.price ?? null,
      errors: c.errorMessage || p.errorMessage || null,
    },
    null,
    2,
  ),
);
