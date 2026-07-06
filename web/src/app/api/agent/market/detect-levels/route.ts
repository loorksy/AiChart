import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import { getSettings } from "@/lib/store";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { detectStructureLevels } from "@/lib/ohlc/structure";

/** Bridge: swing-based support/resistance detection from OHLC. */
export const GET = withBridge(async ({ req, userId }) => {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol");
  if (!symbol?.trim()) {
    throw new ApiError(400, "symbol مطلوب.");
  }

  const settings = await getSettings(userId);
  const rawMarket = searchParams.get("market") ?? settings.active_market;
  const marketErr = rejectNonForexMarket(rawMarket);
  if (marketErr) throw new ApiError(400, marketErr);
  const market = resolveActiveMarket(rawMarket ?? DEFAULT_MARKET);
  const interval = searchParams.get("interval") ?? "1h";
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 120;

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
