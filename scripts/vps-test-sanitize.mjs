import fs from "fs";
process.chdir("/opt/aichart/web");

// Minimal replicate of chartTime.ts sanitize pipeline
function toChartSeconds(time) {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
}

function magnitudeBucket(price) {
  return Math.floor(Math.log10(price));
}

function normalizeCandlesForChart(candles) {
  return candles
    .map((c) => ({
      ...c,
      time: toChartSeconds(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }))
    .filter((c) => c.time > 0)
    .sort((a, b) => a.time - b.time);
}

function sanitizeCandlesForMarket(candles, market) {
  const normalized = normalizeCandlesForChart(candles);
  if (normalized.length === 0) return [];

  const structurallyValid = normalized.filter((c) => {
    const ohlc = [c.open, c.high, c.low, c.close];
    if (ohlc.some((p) => !Number.isFinite(p) || p <= 0)) return false;
    if (c.high < c.low) return false;
    if (c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      return false;
    }
    return true;
  });

  if (market !== "forex" || structurallyValid.length === 0) return structurallyValid;

  const inBounds = structurallyValid.filter(
    (c) => ![c.open, c.high, c.low, c.close].some((p) => p > 1_000_000 || p < 0.000_01),
  );
  if (inBounds.length === 0) return [];

  const counts = new Map();
  for (const c of inBounds) {
    const b = magnitudeBucket(c.close);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let dominant = Infinity;
  let best = -1;
  for (const [bucket, count] of counts) {
    if (count > best || (count === best && bucket < dominant)) {
      best = count;
      dominant = bucket;
    }
  }

  return inBounds.filter((c) => magnitudeBucket(c.close) === dominant);
}

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const token = process.env.OANDA_API_TOKEN;
const base = "https://api-fxpractice.oanda.com";

for (const inst of ["USD_MXN", "EUR_USD"]) {
  const url = `${base}/v3/instruments/${inst}/candles?granularity=M1&count=500&price=M`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const raw = (data.candles ?? [])
    .filter((r) => r.mid)
    .map((r) => ({
      time: Date.parse(r.time),
      open: Number(r.mid.o),
      high: Number(r.mid.h),
      low: Number(r.mid.l),
      close: Number(r.mid.c),
    }));
  const clean = sanitizeCandlesForMarket(raw, "forex");
  const buckets = new Map();
  for (const c of raw) buckets.set(magnitudeBucket(c.close), (buckets.get(magnitudeBucket(c.close)) ?? 0) + 1);
  console.log(inst, "raw", raw.length, "after_sanitize", clean.length, "buckets", Object.fromEntries(buckets));
  if (clean.length < raw.length) {
    const dropped = raw.length - clean.length;
    console.log("  dropped", dropped, "sample bad close", raw.find((c) => magnitudeBucket(c.close) !== [...buckets.keys()].sort((a,b)=> (buckets.get(b)-buckets.get(a)))[0])?.close);
  }
}
