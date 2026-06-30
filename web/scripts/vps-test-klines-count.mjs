// Run from /opt/aichart/web after build — uses compiled modules via dynamic import path
import fs from "fs";
import path from "path";
import { createRequire } from "module";

process.chdir("/opt/aichart/web");
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

// Direct OANDA fetch mimicking fetchOandaCandles
const token = process.env.OANDA_API_TOKEN;
const base = "https://api-fxpractice.oanda.com";
const url = `${base}/v3/instruments/USD_MXN/candles?granularity=M1&count=300&price=M`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const data = await res.json();
const rows = (data.candles ?? []).filter((r) => r.mid);
console.log("direct OANDA count=300:", rows.length, rows[0]?.time, rows[rows.length - 1]?.time);
