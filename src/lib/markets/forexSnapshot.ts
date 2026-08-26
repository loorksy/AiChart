import { normalizeInterval } from "@/lib/intervals";
import { fetchOhlc, type OhlcSource } from "@/lib/ohlc/fetchOhlc";
import { computeForexIndicators } from "@/lib/ohlc/indicators";
import { atr } from "@/lib/indicators";
import type { MarketSnapshot } from "../market";
import { computeForex24hRange } from "./forex24h";
import { getForexLiveMid } from "./forexPrice";

export interface ForexSnapshotMeta {
  ohlcSource?: string;
  ohlcWarning?: string;
  candleCount?: number;
  highLow24hApproximate?: boolean;
}

export type ForexMarketSnapshot = MarketSnapshot & ForexSnapshotMeta;

function emptyForexSnapshot(
  symbol: string,
  interval: string,
  message: string,
): ForexMarketSnapshot {
  return {
    symbol: symbol.toUpperCase().trim(),
    interval,
    price: 0,
    change24hPct: 0,
    high24h: 0,
    low24h: 0,
    rsi14: null,
    sma20: null,
    sma50: null,
    ema20: null,
    macd: null,
    atr14: null,
    trend: "sideways",
    summary: message,
    candleCount: 0,
  };
}

/**
 * Unified forex snapshot: fetchOhlc (the platform's OANDA feed) + computeForexIndicators
 * + live mid price + timestamp-based 24h high/low.
 */
export async function buildForexSnapshot(
  userId: number,
  symbol: string,
  interval = "1h",
  source: OhlcSource = "oanda",
): Promise<ForexMarketSnapshot> {
  const sym = symbol.trim();
  const tf = normalizeInterval(interval);

  let ohlc;
  try {
    ohlc = await fetchOhlc({
      userId,
      symbol: sym,
      interval: tf,
      market: "forex",
      limit: 200,
      source,
    });
  } catch {
    const price = await getForexLiveMid(userId, sym);
    const snap = emptyForexSnapshot(
      sym,
      tf,
      "لا تتوفر بيانات شموع لهذا الرمز حالياً.",
    );
    if (price > 0) {
      snap.price = price;
      snap.summary = `السعر الحالي ${price} · لا تتوفر شموع كافية للمؤشرات.`;
    }
    return snap;
  }

  if (ohlc.candles.length === 0) {
    const price = await getForexLiveMid(userId, sym);
    const snap = emptyForexSnapshot(
      ohlc.symbol,
      tf,
      "لا تتوفر بيانات شموع لهذا الرمز حالياً.",
    );
    if (price > 0) snap.price = price;
    return snap;
  }

  const indicators = computeForexIndicators(
    ohlc.symbol,
    ohlc.interval,
    ohlc.candles,
    ohlc.source,
  );
  const livePrice = await getForexLiveMid(userId, sym);
  const lastClose = ohlc.candles[ohlc.candles.length - 1]?.close ?? 0;
  const price = livePrice > 0 ? livePrice : lastClose;

  const range24h = await computeForex24hRange(
    userId,
    sym,
    tf,
    ohlc.candles,
    price,
  );

  const parts: string[] = [`السعر الحالي ${price}`];
  if (range24h.change24hPct !== 0) {
    parts.push(
      `تغيّر 24س ${range24h.change24hPct >= 0 ? "+" : ""}${range24h.change24hPct.toFixed(2)}%`,
    );
  }
  if (indicators.summary) parts.push(indicators.summary);
  if (range24h.approximate) {
    parts.push("24h high/low تقريبي (فريم > 1h)");
  }
  if (ohlc.warning) parts.push(ohlc.warning);

  return {
    symbol: ohlc.symbol,
    interval: tf,
    price,
    change24hPct: range24h.change24hPct,
    high24h: range24h.high24h,
    low24h: range24h.low24h,
    rsi14: indicators.rsi14,
    sma20: indicators.sma20,
    sma50: indicators.sma50,
    ema20: indicators.ema20,
    macd: indicators.macd,
    atr14: atr(ohlc.candles, 14),
    trend: indicators.trend,
    summary: parts.join(" · "),
    ohlcSource: ohlc.source,
    ohlcWarning: ohlc.warning,
    candleCount: ohlc.candles.length,
    highLow24hApproximate: range24h.approximate,
  };
}
