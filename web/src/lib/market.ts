import { getKlines, get24hStats, getPrice, type BinanceEnv } from "./binance";
import { rsi, sma, ema, macd, atr } from "./indicators";
import { normalizeInterval } from "./intervals";

export { buildForexSnapshot } from "./markets/forexSnapshot";

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
  /** Average True Range (volatility) — for adaptive stops/sizing. */
  atr14: number | null;
  trend: "uptrend" | "downtrend" | "sideways";
  summary: string;
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
  const atr14 = atr(candles, 14);

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
    atr14,
    trend,
    summary: parts.join(" · "),
  };
}
