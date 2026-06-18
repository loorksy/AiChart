import { buildSnapshot, buildForexSnapshot } from "../market";
import { getPrice } from "../binance";
import { getBinanceLivePrice, ensureBinanceLiveQuotes, getBinanceLiveQuotes } from "../binanceLiveState";
import { getForexLiveMid } from "./forexPrice";
import { resolveSymbol, marketLabel } from "./resolve";
import type { MarketType, ResolvedSymbol, UnifiedSnapshot } from "./types";
import type { ForexMarketSnapshot } from "./forexSnapshot";

export { resolveSymbol, marketLabel };
export { getBinanceLiveQuotes, ensureBinanceLiveQuotes, getBinanceLivePrice };
export type { ResolvedSymbol, UnifiedSnapshot };

export async function getUnifiedPrice(
  query: string,
  market: MarketType = "crypto",
  userId?: number,
): Promise<{ resolved: ResolvedSymbol; price: number }> {
  const resolved = resolveSymbol(query, market);
  if (market === "forex") {
    const price = userId ? await getForexLiveMid(userId, resolved.symbol) : 0;
    return { resolved, price };
  }
  if (userId) {
    await ensureBinanceLiveQuotes(userId);
    const live = await getBinanceLivePrice(userId, resolved.symbol);
    if (live && live.price > 0) {
      return { resolved, price: live.price };
    }
  }
  const price = await getPrice(resolved.symbol, "prod");
  return { resolved, price };
}

export async function getUnifiedSnapshot(
  query: string,
  market: MarketType = "crypto",
  interval = "1h",
  userId?: number,
): Promise<UnifiedSnapshot> {
  const resolved = resolveSymbol(query, market);
  const snap =
    market === "forex" && userId
      ? await buildForexSnapshot(userId, resolved.symbol, interval)
      : await buildSnapshot(resolved.symbol, interval, "prod");

  const forexMeta =
    market === "forex" ? (snap as ForexMarketSnapshot) : undefined;

  return {
    symbol: snap.symbol,
    market,
    price: snap.price,
    change24hPct: snap.change24hPct,
    high24h: snap.high24h,
    low24h: snap.low24h,
    summary: snap.summary,
    extra: {
      rsi14: snap.rsi14,
      sma20: snap.sma20,
      sma50: snap.sma50,
      macd: snap.macd,
      trend: snap.trend,
      interval: snap.interval,
      ...(forexMeta?.ohlcSource != null
        ? { ohlcSource: forexMeta.ohlcSource }
        : {}),
      ...(forexMeta?.ohlcWarning
        ? { ohlcWarning: forexMeta.ohlcWarning }
        : {}),
      ...(forexMeta?.candleCount != null
        ? { candleCount: forexMeta.candleCount }
        : {}),
      ...(forexMeta?.highLow24hApproximate != null
        ? { highLow24hApproximate: forexMeta.highLow24hApproximate }
        : {}),
    },
  };
}
