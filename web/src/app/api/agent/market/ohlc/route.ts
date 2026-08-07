import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { marketDataBookLabel } from "@/lib/markets";

/** Bridge: OHLC candles from the trader's resolved market-data pipe. */
export const GET = withBridge(async ({ req, userId }) => {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol");
  if (!symbol?.trim()) {
    throw new ApiError(400, "symbol مطلوب.");
  }

  const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new ApiError(400, marketErr);
  const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);
  const interval = searchParams.get("interval") ?? "1h";
  const decision = await resolveMarketDataSource(
    userId,
    searchParams.get("source"),
  );
  // Broker spellings are case-sensitive — never case-fold here; fetchOhlc
  // resolves the canonical key to the linked account's own spelling.
  const ohlcSymbol = symbol.trim();
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 200;
  const cursorRaw = searchParams.get("cursor");
  const cursor =
    cursorRaw != null && cursorRaw !== "" ? Number(cursorRaw) : undefined;

  if (!Number.isFinite(limit) || limit < 1) {
    throw new ApiError(400, "limit must be a positive number.");
  }
  if (cursor !== undefined && !Number.isFinite(cursor)) {
    throw new ApiError(400, "cursor must be a millisecond timestamp.");
  }

  const result = await fetchOhlc({
    userId,
    symbol: ohlcSymbol,
    interval,
    market,
    source: decision.source,
    limit: Math.min(limit, OHLC_MAX_LIMIT),
    cursor,
  });
  return {
    ...result,
    source: decision.source,
    book: marketDataBookLabel(decision.source),
  };
}, { routeKey: "/api/agent/market/ohlc" });
