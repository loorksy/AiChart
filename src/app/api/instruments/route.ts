import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey } from "@/lib/api";
import { rejectNonForexMarket } from "@/lib/marketPolicy";
import { FOREX_INSTRUMENTS } from "@/lib/markets/forexInstruments";
import { isMarketOpenAt } from "@/lib/markets/tradingCalendar";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
  /** False while the instrument's session is closed — no tape to analyse. */
  market_open: boolean;
  origin: "oanda";
}

function toInstrument(
  entry: (typeof FOREX_INSTRUMENTS)[number],
  now: number,
): Instrument {
  return {
    symbol: entry.symbol,
    base: entry.base,
    quote: entry.quote,
    market_open: isMarketOpenAt(entry.symbol, now),
    origin: "oanda",
  };
}

/**
 * The tradable instrument universe — the platform's fixed 20-instrument
 * list (markets/forexInstruments.ts), served straight from OANDA-backed
 * platform data. No account link, no per-user broker catalogue: every
 * caller, logged in or not, sees the same fixed list.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`instruments:${clientKey(request)}`, 40, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }

    const decision = await resolveMarketDataSource();
    const q = (
      request.nextUrl.searchParams.get("q") ??
      request.nextUrl.searchParams.get("search") ??
      ""
    )
      .trim()
      .toUpperCase();

    const marketParam = request.nextUrl.searchParams.get("market");
    const marketBlock = rejectNonForexMarket(marketParam);
    if (marketBlock) {
      return NextResponse.json({ error: marketBlock }, { status: 400 });
    }

    const now = Date.now();
    const matched = q
      ? FOREX_INSTRUMENTS.filter(
          (i) =>
            i.symbol.includes(q) || i.base.includes(q) || i.quote.includes(q),
        )
      : FOREX_INSTRUMENTS;
    const instruments = matched
      .map((i) => toInstrument(i, now))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({
        instruments,
        total: instruments.length,
        source: "oanda",
        sourceReason: decision.reason,
      });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
