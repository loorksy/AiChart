import { ApiError } from "@/lib/api";
import { withBridge } from "@/lib/bridge";
import {
  DEFAULT_MARKET,
  rejectNonForexMarket,
  resolveActiveMarket,
} from "@/lib/marketPolicy";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import {
  detectNumericMarketRegime,
  MARKET_REGIME_THRESHOLDS,
} from "@/lib/ohlc/marketRegime";

const DEFAULT_LIMIT = 240;
const MAX_LIMIT = 500;

/** Read-only numeric regime detection from fresh server-side OHLC evidence. */
export const GET = withBridge(
  async ({ req, userId }) => {
    const { searchParams } = req.nextUrl;
    const symbol = searchParams.get("symbol")?.trim();
    if (!symbol) throw new ApiError(400, "symbol is required.");

    const rawMarket = searchParams.get("market") ?? DEFAULT_MARKET;
    const marketError = rejectNonForexMarket(rawMarket);
    if (marketError) throw new ApiError(400, marketError);
    const market = resolveActiveMarket(rawMarket);

    const interval = searchParams.get("interval") ?? "1h";
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit == null ? DEFAULT_LIMIT : Number(rawLimit);
    if (
      !Number.isInteger(limit) ||
      limit < MARKET_REGIME_THRESHOLDS.minimumCandles ||
      limit > MAX_LIMIT
    ) {
      throw new ApiError(
        400,
        `limit must be an integer between ${MARKET_REGIME_THRESHOLDS.minimumCandles} and ${MAX_LIMIT}.`,
      );
    }

    let ohlc = await fetchOhlc({
      userId,
      symbol,
      interval,
      market,
      limit,
    });
    // The shared OHLC cache key predates limit-aware consumers. If an earlier
    // small request populated it, bypass that short payload once so regime
    // detection still receives its required indicator window.
    if (ohlc.fromCache && ohlc.candles.length < limit) {
      ohlc = await fetchOhlc({
        userId,
        symbol,
        interval,
        market,
        limit,
        skipCache: true,
      });
    }
    const analysis = detectNumericMarketRegime(ohlc.candles);

    return {
      symbol: ohlc.symbol,
      interval: ohlc.interval,
      market: ohlc.market,
      methodVersion: "atr-adx-bollinger-v1",
      ...analysis,
      ohlcSource: ohlc.source,
      cachedAt: ohlc.cachedAt,
      ageMs: ohlc.ageMs,
      fromCache: ohlc.fromCache,
      warning: ohlc.warning,
    };
  },
  { routeKey: "/api/agent/market/detect-regime", rateLimit: false },
);
