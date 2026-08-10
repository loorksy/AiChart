import { buildForexSnapshot } from "../market";
import { DEFAULT_MARKET } from "../marketPolicy";
import { getForexLiveMid } from "./forexPrice";
import { resolveMarketDataSource } from "./marketDataSource";
import { resolveSymbol, marketLabel } from "./resolve";
import type { MarketType, ResolvedSymbol, UnifiedSnapshot } from "./types";
import type { ForexMarketSnapshot } from "./forexSnapshot";

export { resolveSymbol, marketLabel };
export type { ResolvedSymbol, UnifiedSnapshot };

/** Human book label — a cost without its book is misleading (spreads differ per venue). */
export function marketDataBookLabel(source: "oanda"): string {
  // The platform's OANDA feed is the only book.
  void source;
  return "oanda";
}

export async function getUnifiedPrice(
  query: string,
  market: MarketType = DEFAULT_MARKET,
  userId?: number,
): Promise<{
  resolved: ResolvedSymbol;
  price: number;
  source: "oanda";
  book: string;
}> {
  const resolved = resolveSymbol(query, market);
  const decision = await resolveMarketDataSource(userId ?? null, null);
  const price = userId ? await getForexLiveMid(userId, resolved.symbol) : 0;
  return {
    resolved,
    price,
    source: decision.source,
    book: marketDataBookLabel(decision.source),
  };
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
  const decision = await resolveMarketDataSource(userId, null);
  // Preserve broker spelling — resolveSymbol already keeps suffixes; folding
  // here would break MetaApi lookups.
  const symbolForPipe = query.trim() || resolved.symbol;
  const snap = await buildForexSnapshot(
    userId,
    symbolForPipe,
    interval,
    decision.source,
  );
  const forexMeta = snap as ForexMarketSnapshot;
  const book = marketDataBookLabel(decision.source);

  return {
    symbol: snap.symbol,
    market: DEFAULT_MARKET,
    price: snap.price,
    change24hPct: snap.change24hPct,
    high24h: snap.high24h,
    low24h: snap.low24h,
    summary: `${snap.summary} · book=${book}`,
    extra: {
      rsi14: snap.rsi14,
      sma20: snap.sma20,
      sma50: snap.sma50,
      macd: snap.macd,
      trend: snap.trend,
      interval: snap.interval,
      source: decision.source,
      book,
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
