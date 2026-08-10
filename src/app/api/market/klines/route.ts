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
} from "@/lib/ohlc/chartTime";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { defaultKlineLimit } from "@/lib/ohlc/klineLimits";
import { normalizeInterval } from "@/lib/intervals";
import { ohlcCacheTtlMs } from "@/lib/markets/intervals";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import type { MarketType } from "@/lib/markets/types";

/**
 * Market UI klines — live from the platform's OANDA feed, every request. No
 * account link is required; an unconfigured platform gets a typed error.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`klines:${clientKey(req)}`, 60, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }
    /*
     * Case preserved end to end: a broker answers to its OWN spelling, and
     * Exness spells its symbols with a lowercase suffix — XAUUSDm, EURUSDm.
     * Uppercasing turned XAUUSDm into XAUUSDM, and MetaApi replied "Symbol
     * XAUUSDM does not exist" after ~75s of retries. The character filter
     * still runs; it keeps `_` because broker suffixes use it.
     */
    const symbolRaw = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");
    const intervalRaw = req.nextUrl.searchParams.get("interval") || "1h";
    const interval = normalizeInterval(intervalRaw);
    const market: MarketType = "forex";
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = Math.max(
      Number(limitParam || defaultKlineLimit(interval, market)),
      10,
    );
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const beforeRaw = req.nextUrl.searchParams.get("before");
    const fromRaw = req.nextUrl.searchParams.get("from");
    const toRaw = req.nextUrl.searchParams.get("to");
    const beforeMs =
      beforeRaw != null && beforeRaw !== "" ? Number(beforeRaw) : undefined;
    const fromMs =
      fromRaw != null && fromRaw !== "" ? Number(fromRaw) : undefined;
    const toMs =
      toRaw != null && toRaw !== "" ? Number(toRaw) : undefined;

    const dataSource = await resolveMarketDataSource();
    if (!dataSource.available.oanda) {
      return NextResponse.json({
        symbol: symbolRaw,
        interval,
        market,
        source: "oanda",
        candles: [],
        pending: false,
        error: "بيانات السوق غير متاحة حاليًا — تعذّر الاتصال بمزوّد البيانات.",
      });
    }

    const broker = await fetchOhlc({
      userId: user?.id ?? 0,
      symbol: symbolRaw,
      interval,
      limit,
      skipCache: fresh || beforeMs != null || fromMs != null || toMs != null,
      beforeMs: Number.isFinite(beforeMs) ? beforeMs : undefined,
      fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
      toMs: Number.isFinite(toMs) ? toMs : undefined,
    });
    const normalized = normalizeCandlesForChart(broker.candles);
    const candles = sanitizeCandlesForMarket(normalized, market);
    const res = NextResponse.json({
      symbol: symbolRaw,
      interval,
      market,
      source: "oanda",
      candles,
      pending: candles.length === 0 && Boolean(broker.warning),
      fromCache: broker.fromCache,
      ...(broker.warning ? { error: broker.warning } : {}),
    });
    const ttlSec = Math.round(ohlcCacheTtlMs(interval) / 1000);
    res.headers.set(
      "Cache-Control",
      `private, max-age=${Math.min(ttlSec, 30)}, stale-while-revalidate=${ttlSec}`,
    );
    return res;
  } catch (err) {
    return handleError(err);
  }
}
