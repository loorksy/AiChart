import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey, handleError } from "@/lib/api";
import { fetchOhlc } from "@/lib/ohlc/fetchOhlc";
import { changePct, downsample, type PairQuote } from "@/lib/markets/pairQuote";
import {
  resolveMarketDataSource,
  type MarketDataSource,
} from "@/lib/markets/marketDataSource";

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

async function quoteFor(
  userId: number,
  symbol: string,
  source: MarketDataSource,
): Promise<PairQuote> {
  try {
    const { candles } = await fetchOhlc({
      userId,
      symbol,
      interval: WINDOW_INTERVAL,
      limit: WINDOW_BARS,
      source,
    });
    const closes = candles.map((c) => c.close).filter((n) => Number.isFinite(n));
    return {
      symbol,
      price: closes.length ? closes[closes.length - 1] : null,
      changePct: changePct(closes),
      series: downsample(closes, SPARK_POINTS),
    };
  } catch {
    // A pair whose history is unavailable still gets a card — an empty one.
    return { symbol, price: null, changePct: null, series: [] };
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
          // Case preserved: a broker's catalogue is case-sensitive, and these
          // symbols come straight from it (XAUUSDm, AAPLm). Folding them here
          // asked MetaApi for instruments that do not exist, so every card in
          // the cloud catalogue rendered blank.
          .map((s) => s.trim().replace(/[^A-Za-z0-9._]/g, ""))
          .filter(Boolean),
      ),
    ).slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      return NextResponse.json({ quotes: [] });
    }

    // Same rule as the catalogue: only an EA-backed account can be quoted from
    // the trader's own terminal; every other connection reads platform data.
    const { source } = await resolveMarketDataSource(
      user?.id ?? null,
      req.nextUrl.searchParams.get("source"),
    );

    const quotes: PairQuote[] = [];
    for (let i = 0; i < symbols.length; i += CONCURRENCY) {
      const batch = symbols.slice(i, i + CONCURRENCY);
      quotes.push(
        ...(await Promise.all(
          batch.map((symbol) => quoteFor(user?.id ?? 0, symbol, source)),
        )),
      );
    }

    return NextResponse.json({ quotes, interval: WINDOW_INTERVAL, source });
  } catch (e) {
    return handleError(e);
  }
}
