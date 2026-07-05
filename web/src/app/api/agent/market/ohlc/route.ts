import { withBridge } from "@/lib/bridge";
import { ApiError } from "@/lib/api";
import { getSettings } from "@/lib/store";
import type { MarketType } from "@/lib/markets/types";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";

/** Bridge: OHLC candles — forex via EA get_ohlc, crypto via Binance klines. */
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
  const sourceRaw = searchParams.get("source");
  const source =
    isOandaDataOnly() || sourceRaw === "oanda"
      ? "oanda"
      : sourceRaw === "ea"
        ? "ea"
        : undefined;
  const rawSymbol = symbol.trim().toUpperCase();
  const ohlcSymbol =
    market === "forex" && source !== "ea"
      ? forexCanonicalKey(rawSymbol)
      : rawSymbol;
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

  return fetchOhlc({
    userId,
    symbol: ohlcSymbol,
    interval,
    market,
    source,
    limit: Math.min(limit, OHLC_MAX_LIMIT),
    cursor,
  });
}, { routeKey: "/api/agent/market/ohlc" });
