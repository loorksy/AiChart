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

const instRes = await fetch(`${base}/v3/accounts/${acct}/instruments`, { headers: h });
const instData = await instRes.json();
const mxn = (instData.instruments ?? []).filter((i) =>
  i.name.includes("MXN"),
);
console.log("MXN instruments:", mxn.map((i) => i.name).join(", "));

for (const inst of ["USD_MXN", ...mxn.slice(0, 3).map((i) => i.name)]) {
  const url = `${base}/v3/instruments/${inst}/candles?granularity=M1&count=500&price=M`;
  const res = await fetch(url, { headers: h });
  const data = await res.json();
  const rows = data.candles ?? [];
  console.log(
    inst,
    res.status,
    rows.length,
    data.errorMessage ?? "",
    rows[0]?.time?.slice(11, 16),
    "-",
    rows[rows.length - 1]?.time?.slice(11, 16),
  );
}
