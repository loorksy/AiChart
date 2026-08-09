import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { ANALYSIS_BOOK_LABEL, fetchAnalysisCandleFeed } from "@/lib/markets/analysisCandleFeed";
import { detectStructureLevels } from "@/lib/ohlc/structure";

/** Bridge: swing-based support/resistance detection from OHLC. */
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
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 120;

  const decision = await resolveMarketDataSource(userId, null);

  // No linked account to read from — analysis-only reference data instead of
  // an error (plan §5: detect_levels is analysis-only, no account tie-in).
  if (!decision.available.metaapi) {
    const fed = await fetchAnalysisCandleFeed(symbol, interval, Number.isFinite(limit) ? limit : 120);
    if (fed.candles.length < 10) {
      throw new ApiError(503, "لا تتوفر شموع كافية لاكتشاف المستويات.");
    }
    const levels = detectStructureLevels(fed.symbol, fed.interval, fed.candles);
    return {
      ...levels,
      ohlcSource: ANALYSIS_BOOK_LABEL,
      candleCount: fed.candles.length,
      cachedAt: Date.now(),
      ageMs: 0,
      fromCache: false,
      warning: fed.warning,
    };
  }

  const ohlc = await fetchOhlc({
    userId,
    symbol,
    interval,
    market,
    limit: Number.isFinite(limit) ? limit : 120,
  });

  if (ohlc.candles.length < 10) {
    throw new ApiError(503, "لا تتوفر شموع كافية لاكتشاف المستويات.");
  }

  const levels = detectStructureLevels(
    ohlc.symbol,
    ohlc.interval,
    ohlc.candles,
  );

  return {
    ...levels,
    ohlcSource: ohlc.source,
    candleCount: ohlc.candles.length,
    cachedAt: ohlc.cachedAt,
    ageMs: ohlc.ageMs,
    fromCache: ohlc.fromCache,
    warning: ohlc.warning,
  };
}, { routeKey: "/api/agent/market/detect-levels" });
