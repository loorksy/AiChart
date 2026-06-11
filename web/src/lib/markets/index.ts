import { buildSnapshot, buildForexSnapshot } from "../market";
import { getPrice } from "../binance";
import { getEaConnection, parseEaSymbolSpecs } from "../eaStore";
import { getForexBackend } from "../brokers/forexBackend";
import { mt5Price } from "../mt5local/client";
import { resolveSymbol, marketLabel } from "./resolve";
import type { MarketType, ResolvedSymbol, UnifiedSnapshot } from "./types";

export { resolveSymbol, marketLabel };
export type { ResolvedSymbol, UnifiedSnapshot };

async function forexPrice(userId: number, symbol: string): Promise<number> {
  if (getForexBackend() === "mt5local") {
    try {
      const { bid, ask } = await mt5Price(symbol);
      if (bid && ask) return (bid + ask) / 2;
      return bid || ask || 0;
    } catch {
      return 0;
    }
  }
  const conn = await getEaConnection(userId);
  if (!conn) return 0;
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) => s.symbol?.toUpperCase() === symbol.toUpperCase(),
  );
  if (!spec) return 0;
  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  if (bid && ask) return (bid + ask) / 2;
  return bid || ask || 0;
}

export async function getUnifiedPrice(
  query: string,
  market: MarketType = "crypto",
  userId?: number,
): Promise<{ resolved: ResolvedSymbol; price: number }> {
  const resolved = resolveSymbol(query, market);
  if (market === "forex") {
    const price = userId ? await forexPrice(userId, resolved.symbol) : 0;
    return { resolved, price };
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
    },
  };
}
