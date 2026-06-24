import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { normalizeCandlesForChart } from "@/lib/ohlc/chartTime";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";

/**
 * Market UI klines — delegates to fetchOhlc (same path as the agent):
 * forex on-demand get_ohlc + resolveMt5Symbol + resampling, crypto Binance + resampling.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbol = (req.nextUrl.searchParams.get("symbol") || "BTCUSDT")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");
    const intervalRaw = req.nextUrl.searchParams.get("interval") || "1h";
    const interval = normalizeInterval(intervalRaw);
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") || 200), 10),
      OHLC_MAX_LIMIT,
    );
    const market = (req.nextUrl.searchParams.get("market") === "forex"
      ? "forex"
      : "crypto") as MarketType;

    const fresh = req.nextUrl.searchParams.get("fresh") === "1";

    try {
      const result = await fetchOhlc({
        userId: user.id,
        symbol,
        interval,
        market,
        limit,
        skipCache: fresh,
      });

      const candles = normalizeCandlesForChart(result.candles).slice(-limit);

      const res = NextResponse.json({
        symbol: result.symbol,
        interval: result.interval,
        market: result.market,
        candles,
        pending: candles.length === 0,
        source: result.source,
        fromCache: result.fromCache,
        warning: result.warning,
      });
      res.headers.set(
        "Cache-Control",
        result.fromCache
          ? "private, max-age=30, stale-while-revalidate=60"
          : "private, max-age=15, stale-while-revalidate=45",
      );
      return res;
    } catch (liveErr) {
      const message =
        liveErr instanceof Error ? liveErr.message : "Failed to load candles.";
      return NextResponse.json({
        symbol,
        interval,
        market,
        candles: [],
        pending: true,
        error: message,
      });
    }
  } catch (err) {
    return handleError(err);
  }
}
