import { buildSnapshot } from "../market";
import { getPrice } from "../binance";
import { resolveSymbol, marketLabel } from "./resolve";
import type { ResolvedSymbol, UnifiedSnapshot } from "./types";

export { resolveSymbol, marketLabel };
export type { ResolvedSymbol, UnifiedSnapshot };

export async function getUnifiedPrice(
  query: string,
): Promise<{ resolved: ResolvedSymbol; price: number }> {
  const resolved = resolveSymbol(query);
  const price = await getPrice(resolved.symbol, "prod");
  return { resolved, price };
}

export async function getUnifiedSnapshot(
  query: string,
  interval = "1h",
): Promise<UnifiedSnapshot> {
  const resolved = resolveSymbol(query);
  const snap = await buildSnapshot(resolved.symbol, interval, "prod");
  return {
    symbol: snap.symbol,
    market: "crypto",
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
    },
  };
}
