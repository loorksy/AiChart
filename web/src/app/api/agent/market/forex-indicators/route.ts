import { withBridge } from "@/lib/bridge";
import { getCached, setCached } from "@/lib/bridge/cache";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import type { MarketType } from "@/lib/markets/types";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
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

  const settings = await getSettings(userId);
  const market = (searchParams.get("market") ??
    settings.active_market ??
    "crypto") as MarketType;
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
      "لا تتوفر شموع كافية لحساب المؤشرات — انتظر EA أو جرّب interval أطول.",
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
