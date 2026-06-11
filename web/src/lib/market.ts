import { getKlines, get24hStats, getPrice, type BinanceEnv } from "./binance";
import { rsi, sma, ema, macd } from "./indicators";
import { getEaCandles } from "./eaStore";
import { getForexBackend } from "./brokers/forexBackend";
import { mt5Rates } from "./mt5local/client";
import { normalizeInterval } from "./intervals";

export interface MarketSnapshot {
  symbol: string;
  interval: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  trend: "uptrend" | "downtrend" | "sideways";
  summary: string;
}

interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Builds a technical snapshot from a raw candle series + spot price. */
function snapshotFromCandles(
  symbol: string,
  interval: string,
  candles: OhlcBar[],
  currentPrice: number,
): MarketSnapshot {
  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  const price = currentPrice || lastClose;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi14 = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const macdRes = macd(closes);

  let trend: MarketSnapshot["trend"] = "sideways";
  if (sma20 !== null && sma50 !== null) {
    if (sma20 > sma50 * 1.002) trend = "uptrend";
    else if (sma20 < sma50 * 0.998) trend = "downtrend";
  }

  const parts: string[] = [`السعر الحالي ${price}`];
  if (rsi14 !== null) {
    const rsiState =
      rsi14 >= 70 ? "تشبّع شرائي" : rsi14 <= 30 ? "تشبّع بيعي" : "محايد";
    parts.push(`RSI ${rsi14.toFixed(1)} (${rsiState})`);
  }
  parts.push(
    `الاتجاه ${trend === "uptrend" ? "صاعد" : trend === "downtrend" ? "هابط" : "عرضي"}`,
  );

  return {
    symbol,
    interval,
    price,
    change24hPct: 0,
    high24h: highs.length ? Math.max(...highs.slice(-24)) : 0,
    low24h: lows.length ? Math.min(...lows.slice(-24)) : 0,
    rsi14,
    sma20,
    sma50,
    ema20,
    macd: macdRes,
    trend,
    summary: parts.join(" · "),
  };
}

/** Forex snapshot from the MT5 bridge or EA-streamed candles (no Binance). */
export async function buildForexSnapshot(
  userId: number,
  symbol: string,
  interval = "1h",
): Promise<MarketSnapshot> {
  const sym = symbol.toUpperCase().trim();
  const tf = normalizeInterval(interval);
  let candles: OhlcBar[] = [];

  if (getForexBackend() === "mt5local") {
    try {
      const bars = await mt5Rates(sym, tf, 120);
      candles = bars.map((b) => ({
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    } catch {
      candles = [];
    }
  } else {
    const cached = await getEaCandles(userId, sym, tf);
    if (cached) {
      try {
        candles = (JSON.parse(cached.candles_json) as OhlcBar[]).map((b) => ({
          open: Number(b.open),
          high: Number(b.high),
          low: Number(b.low),
          close: Number(b.close),
        }));
      } catch {
        candles = [];
      }
    }
  }

  const last = candles[candles.length - 1]?.close ?? 0;
  const snap = snapshotFromCandles(sym, tf, candles, last);
  if (candles.length === 0) {
    snap.summary = "لا تتوفر بيانات شموع بعد من MetaTrader لهذا الرمز.";
  }
  return snap;
}

/**
 * Builds a structured technical snapshot for a symbol. This is the cheap
 * monitoring layer — pure code, no LLM — that feeds the decision layer.
 */
export async function buildSnapshot(
  symbol: string,
  interval = "1h",
  env: BinanceEnv = "prod",
): Promise<MarketSnapshot> {
  const sym = symbol.toUpperCase().trim();
  const tf = normalizeInterval(interval);

  const [candles, stats, price] = await Promise.all([
    getKlines(sym, tf, 200, env),
    get24hStats(sym, env).catch(() => null),
    getPrice(sym, env).catch(() => null),
  ]);

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1] ?? 0;
  const currentPrice = price ?? lastClose;

  const rsi14 = rsi(closes, 14);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const macdRes = macd(closes);

  let trend: MarketSnapshot["trend"] = "sideways";
  if (sma20 !== null && sma50 !== null) {
    if (sma20 > sma50 * 1.002) trend = "uptrend";
    else if (sma20 < sma50 * 0.998) trend = "downtrend";
  }

  const parts: string[] = [];
  parts.push(`السعر الحالي ${currentPrice}`);
  if (stats) parts.push(`تغيّر 24س ${stats.priceChangePercent.toFixed(2)}%`);
  if (rsi14 !== null) {
    const rsiState =
      rsi14 >= 70 ? "تشبّع شرائي" : rsi14 <= 30 ? "تشبّع بيعي" : "محايد";
    parts.push(`RSI ${rsi14.toFixed(1)} (${rsiState})`);
  }
  parts.push(
    `الاتجاه ${trend === "uptrend" ? "صاعد" : trend === "downtrend" ? "هابط" : "عرضي"}`,
  );

  return {
    symbol: sym,
    interval: tf,
    price: currentPrice,
    change24hPct: stats?.priceChangePercent ?? 0,
    high24h: stats?.high ?? 0,
    low24h: stats?.low ?? 0,
    rsi14,
    sma20,
    sma50,
    ema20,
    macd: macdRes,
    trend,
    summary: parts.join(" · "),
  };
}
