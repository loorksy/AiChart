import { withBridge } from "@/lib/bridge";
import { getCached, setCached } from "@/lib/bridge/cache";
import { ApiError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { fetchAnalysisCandleFeed } from "@/lib/markets/analysisCandleFeed";
import {
  computeForexIndicators,
  INDICATORS_CACHE_TTL_MS,
  indicatorsCacheResource,
} from "@/lib/ohlc/indicators";

/** Bridge: technical indicators from cached/fresh OHLC. */
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
  const cacheKey = indicatorsCacheResource(symbol, interval);

  const hit = await getCached<ReturnType<typeof computeForexIndicators>>(userId, cacheKey);
  if (hit.fromCache) {
    return {
      ...hit.value,
      cachedAt: hit.cachedAt,
      ageMs: hit.ageMs,
      fromCache: true,
    };
  }

  const decision = await resolveMarketDataSource(userId, null);

  // No linked account to read from — analysis-only reference data instead of
  // an error (plan §5: get_forex_indicators is analysis-only, no account tie-in).
  if (!decision.available.metaapi) {
    const fed = await fetchAnalysisCandleFeed(symbol, interval, 200);
    if (fed.candles.length < 20) {
      throw new ApiError(
        503,
        "لا تتوفر شموع كافية لحساب المؤشرات — أعد المحاولة لاحقاً أو جرّب interval أطول.",
      );
    }
    const indicators = computeForexIndicators(fed.symbol, fed.interval, fed.candles, "reference_feed");
    await setCached(userId, cacheKey, indicators, INDICATORS_CACHE_TTL_MS);
    return {
      ...indicators,
      ohlcSource: "reference_feed",
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
    limit: 200,
  });

  if (ohlc.candles.length < 20) {
    throw new ApiError(
      503,
      "لا تتوفر شموع كافية لحساب المؤشرات — أعد المحاولة لاحقاً أو جرّب interval أطول.",
    );
  }

  const indicators = computeForexIndicators(
    ohlc.symbol,
    ohlc.interval,
    ohlc.candles,
    ohlc.source,
  );

  await setCached(userId, cacheKey, indicators, INDICATORS_CACHE_TTL_MS);

  return {
    ...indicators,
    ohlcSource: ohlc.source,
    candleCount: ohlc.candles.length,
    cachedAt: Date.now(),
    ageMs: 0,
    fromCache: false,
    warning: ohlc.warning,
  };
}, { routeKey: "/api/agent/market/forex-indicators" });
