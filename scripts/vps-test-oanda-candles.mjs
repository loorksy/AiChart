import fs from "fs";
process.chdir("/opt/aichart/web");
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const token = process.env.OANDA_API_TOKEN;
const base = "https://api-fxpractice.oanda.com";

for (const inst of ["USD_MXN", "EUR_USD"]) {
  const url = `${base}/v3/instruments/${inst}/candles?granularity=M1&count=300&price=M`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const rows = data.candles ?? [];
  const withMid = rows.filter((r) => r.mid);
  console.log(
    inst,
    "status",
    res.status,
    "total",
    rows.length,
    "with_mid",
    withMid.length,
    "first",
    rows[0]?.time,
    "last",
    rows[rows.length - 1]?.time,
  );
}
