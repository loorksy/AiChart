import { buildForexSnapshot } from "../market";
import { DEFAULT_MARKET } from "../marketPolicy";
import { getForexLiveMid } from "./forexPrice";
import { resolveSymbol, marketLabel } from "./resolve";
import type { MarketType, ResolvedSymbol, UnifiedSnapshot } from "./types";
import type { ForexMarketSnapshot } from "./forexSnapshot";

export { resolveSymbol, marketLabel };
export type { ResolvedSymbol, UnifiedSnapshot };

export async function getUnifiedPrice(
  query: string,
  market: MarketType = DEFAULT_MARKET,
  userId?: number,
): Promise<{ resolved: ResolvedSymbol; price: number }> {
  const resolved = resolveSymbol(query, market);
  const price = userId ? await getForexLiveMid(userId, resolved.symbol) : 0;
  return { resolved, price };
}

export async function getUnifiedSnapshot(
  query: string,
  market: MarketType = DEFAULT_MARKET,
  interval = "1h",
  userId?: number,
): Promise<UnifiedSnapshot> {
  const resolved = resolveSymbol(query, market);
  if (!userId) {
    throw new Error("Forex snapshots require a connected user session.");
  }
  const snap = await buildForexSnapshot(userId, resolved.symbol, interval);
  const forexMeta = snap as ForexMarketSnapshot;

  return {
    symbol: snap.symbol,
    market: DEFAULT_MARKET,
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
      ...(forexMeta.ohlcSource != null
        ? { ohlcSource: forexMeta.ohlcSource }
        : {}),
      ...(forexMeta.ohlcWarning ? { ohlcWarning: forexMeta.ohlcWarning } : {}),
      ...(forexMeta.candleCount != null
        ? { candleCount: forexMeta.candleCount }
        : {}),
      ...(forexMeta.highLow24hApproximate != null
        ? { highLow24hApproximate: forexMeta.highLow24hApproximate }
        : {}),
    },
  };
}
