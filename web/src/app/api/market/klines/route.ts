import { NextRequest, NextResponse } from "next/server";
import {
  getOptionalUser,
  checkRateLimit,
  clientKey,
  handleError,
} from "@/lib/api";
import {
  normalizeCandlesForChart,
  sanitizeCandlesForMarket,
  toChartSeconds,
} from "@/lib/ohlc/chartTime";
import { fetchOhlc, OHLC_MAX_LIMIT } from "@/lib/ohlc/fetchOhlc";
import { fetchEaOhlc } from "@/lib/ohlc/eaOhlc";
import { defaultKlineLimit } from "@/lib/ohlc/klineLimits";
import { normalizeInterval } from "@/lib/intervals";
import type { MarketType } from "@/lib/markets/types";

/** Market UI klines — forex via OANDA, crypto via Binance. */
export async function GET(req: NextRequest) {
  try {
    // Public: guests may load candles to browse the chart (rate-limited).
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`klines:${clientKey(req)}`, 60, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }
    const userId = user?.id ?? 0;
    const symbol = (req.nextUrl.searchParams.get("symbol") || "BTCUSDT")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");
    const intervalRaw = req.nextUrl.searchParams.get("interval") || "1h";
    const interval = normalizeInterval(intervalRaw);
    const market = (req.nextUrl.searchParams.get("market") === "forex"
      ? "forex"
      : "crypto") as MarketType;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.min(
      Math.max(
        Number(limitParam || defaultKlineLimit(interval, market)),
        10,
      ),
      OHLC_MAX_LIMIT,
    );
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const cursorRaw = req.nextUrl.searchParams.get("cursor");
    const beforeRaw = req.nextUrl.searchParams.get("before");
    const fromRaw = req.nextUrl.searchParams.get("from");
    const toRaw = req.nextUrl.searchParams.get("to");
    const cursor =
      cursorRaw != null && cursorRaw !== "" ? Number(cursorRaw) : undefined;
    const beforeMs =
      beforeRaw != null && beforeRaw !== "" ? Number(beforeRaw) : undefined;
    const fromMs =
      fromRaw != null && fromRaw !== "" ? Number(fromRaw) : undefined;
    const toMs =
      toRaw != null && toRaw !== "" ? Number(toRaw) : undefined;

    // Second data source: the user's own broker via the EA bridge (MT5).
    if (req.nextUrl.searchParams.get("source") === "ea") {
      if (!user) {
        return NextResponse.json(
          { error: "بيانات الوسيط تتطلب تسجيل الدخول وربط MetaTrader." },
          { status: 401 },
        );
      }
      const ea = await fetchEaOhlc(user.id, symbol, interval, {
        fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
        toMs: Number.isFinite(toMs) ? toMs : undefined,
        limit,
      });
      const normalized = normalizeCandlesForChart(ea.candles);
      const candles = sanitizeCandlesForMarket(normalized, "forex");
      return NextResponse.json({
        symbol,
        interval,
        market: "forex",
        source: "ea",
        candles,
        // Empty WITHOUT a warning = genuine market gap (EA acked success) —
        // don't flag pending, or the client burns retries on every weekend.
        pending: candles.length === 0 && Boolean(ea.warning),
        ...(ea.warning ? { error: ea.warning } : {}),
      });
    }

    try {
      const result = await fetchOhlc({
        userId,
        symbol,
        interval,
        market,
        limit,
        skipCache:
          fresh ||
          cursor != null ||
          beforeMs != null ||
          fromMs != null ||
          toMs != null,
        cursor: Number.isFinite(cursor) ? cursor : undefined,
        beforeMs: Number.isFinite(beforeMs) ? beforeMs : undefined,
        fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
        toMs: Number.isFinite(toMs) ? toMs : undefined,
      });

      const normalized = normalizeCandlesForChart(result.candles);
      const candles = sanitizeCandlesForMarket(normalized, market);
      const trimmed =
        beforeMs != null && Number.isFinite(beforeMs)
          ? candles
          : fromMs != null && Number.isFinite(fromMs)
            ? candles
            : candles.slice(-limit);

      if (normalized.length > 0 && candles.length === 0) {
        return NextResponse.json({
          symbol: result.symbol,
          interval: result.interval,
          market: result.market,
          candles: [],
          pending: false,
          error: "بيانات الشارت غير متوافقة مع الرمز",
          source: result.source,
          fromCache: result.fromCache,
        });
      }

      const nextCursor =
        market === "crypto" && result.nextCursor
          ? result.nextCursor
          : trimmed.length > 0
            ? toChartSeconds(trimmed[0]!.time) * 1000
            : null;

      const res = NextResponse.json({
        symbol: result.symbol,
        interval: result.interval,
        market: result.market,
        candles: trimmed,
        pending: trimmed.length === 0,
        source: result.source,
        fromCache: result.fromCache,
        warning: result.warning,
        nextCursor,
        hasMore: result.hasMore ?? false,
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
