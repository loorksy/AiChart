import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey, handleError } from "@/lib/api";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { changePct, downsample, type PairQuote } from "@/lib/markets/pairQuote";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { fetchOandaPricing } from "@/lib/markets/oanda";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));

/** One card's worth of history: ~a day of hourly closes. */
const WINDOW_INTERVAL = "1h";
const WINDOW_BARS = 25;
/** Points kept per sparkline — more than a 120px-wide card can resolve. */
const SPARK_POINTS = 24;
/**
 * Cards are fetched as they scroll into view, so a request covers a screenful,
 * not the catalogue. The cap bounds what one open of the picker can cost the
 * upstream data provider.
 */
const MAX_SYMBOLS = 12;
/** Upstream is one request per instrument; a few in flight, not twelve. */
const CONCURRENCY = 4;

/** Live mid from the platform's OANDA feed — headline price, not the last hourly close. */
async function liveMid(symbol: string): Promise<number | null> {
  try {
    const canonical = forexCanonicalKey(symbol) || symbol;
    const [q] = await fetchOandaPricing([canonical]);
    if (!q || q.bid == null || q.ask == null) return null;
    if (!Number.isFinite(q.bid) || !Number.isFinite(q.ask)) return null;
    return (q.bid + q.ask) / 2;
  } catch {
    return null;
  }
}

async function quoteFor(symbol: string): Promise<PairQuote> {
  try {
    const [{ candles }, live] = await Promise.all([
      fetchOhlc({
        userId: 0,
        symbol,
        interval: WINDOW_INTERVAL,
        limit: WINDOW_BARS,
      }),
      liveMid(symbol),
    ]);
    const closes = candles.map((c) => c.close).filter((n) => Number.isFinite(n));
    const lastClose = closes.length ? closes[closes.length - 1] : null;
    return {
      symbol,
      // Live tick when the pipe answers; sparkline still comes from OHLC.
      price: live ?? lastClose,
      changePct: changePct(closes),
      series: downsample(closes, SPARK_POINTS),
      live: live != null,
    };
  } catch {
    // A pair whose history is unavailable still gets a card — an empty one.
    return { symbol, price: null, changePct: null, series: [], live: false };
  }
}

/** Batch quote + sparkline for the pair picker's cards. */
export async function GET(req: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`instrument-quotes:${clientKey(req)}`, 30, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }

    const symbols = Array.from(
      new Set(
        (req.nextUrl.searchParams.get("symbols") ?? "")
          .split(",")
          .map((s) => s.trim().replace(/[^A-Za-z0-9._]/g, ""))
          .filter(Boolean)
          .filter((s) => TRADABLE_SET.has(forexCanonicalKey(s))),
      ),
    ).slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      return NextResponse.json({ quotes: [] });
    }

    // OANDA is the platform-level book; no account link is required.
    const decision = await resolveMarketDataSource();
    if (!decision.available.oanda) {
      return NextResponse.json({
        quotes: symbols.map((symbol) => ({
          symbol,
          price: null,
          changePct: null,
          series: [],
          live: false,
        })),
        interval: WINDOW_INTERVAL,
        source: "oanda",
      });
    }

    const quotes: PairQuote[] = [];
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      quotes.push(
        ...(await Promise.all(batch.map((symbol) => quoteFor(symbol)))),
      );
    }

    return NextResponse.json({ quotes, interval: WINDOW_INTERVAL, source: "oanda" });
  } catch (e) {
    return handleError(e);
  }
}
