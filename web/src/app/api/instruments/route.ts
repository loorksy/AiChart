import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey } from "@/lib/api";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";
import { forexBaseQuote } from "@/lib/markets/forexInstruments";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";
import {
  fetchOandaInstruments,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

function symbolMatchesQuery(symbol: string, query: string): boolean {
  if (!query) return true;
  const upper = symbol.toUpperCase();
  if (upper.includes(query)) return true;
  return forexCanonicalKey(symbol) === forexCanonicalKey(query);
}

/** Forex universe from OANDA — official market-data source; execution stays on EA/MT5. */
async function oandaForexInstruments(
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const map = new Map<string, Instrument>();
  const query = q.trim().toUpperCase();
  const rows = await fetchOandaInstruments();
  for (const row of rows) {
    if (row.type !== "CURRENCY" && row.type !== "METAL") continue;
    const symbol = row.symbol.toUpperCase();
    if (!symbolMatchesQuery(symbol, query)) continue;
    if (!map.has(symbol)) {
      const { base, quote } = forexBaseQuote(symbol);
      map.set(symbol, { symbol, base, quote });
    }
  }
  const instruments = Array.from(map.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
  return { instruments, total: instruments.length };
}

export async function GET(request: NextRequest) {
  try {
    // Public: guests need the instrument list to switch pairs while browsing.
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`instruments:${clientKey(request)}`, 40, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }

    // Second data source: the user's ENTIRE broker symbol universe via the EA
    // bridge (not just MT5 Market Watch).
    if (
      !isOandaDataOnly() &&
      request.nextUrl.searchParams.get("source") === "ea"
    ) {
      if (!user) {
        return NextResponse.json(
          { error: "أزواج الوسيط تتطلب تسجيل الدخول وربط MetaTrader." },
          { status: 401 },
        );
      }
      const { getAllBrokerSymbols } = await import("@/lib/markets/eaSymbols");
      const { symbols, source } = await getAllBrokerSymbols(user.id);
      const query = (
        request.nextUrl.searchParams.get("q") ??
        request.nextUrl.searchParams.get("search") ??
        ""
      )
        .trim()
        .toUpperCase();
      const rows = symbols.filter(
        (s) =>
          !query ||
          s.symbol.toUpperCase().includes(query) ||
          s.description.toUpperCase().includes(query),
      );
      return NextResponse.json({
        instruments: rows.map((s) => ({
          symbol: s.symbol,
          base: s.symbol.slice(0, 3),
          quote: s.symbol.slice(3, 6),
          digits: s.digits,
          description: s.description,
        })),
        total: rows.length,
        source,
      });
    }

    const q = (
      request.nextUrl.searchParams.get("q") ??
      request.nextUrl.searchParams.get("search") ??
      ""
    ).trim();
    const market = request.nextUrl.searchParams.get("market") === "forex"
      ? "forex"
      : "crypto";

    const { instruments, total } =
      market === "forex"
        ? oandaConfigured() && oandaAccountId()
          ? await oandaForexInstruments(q)
          : { instruments: [], total: 0 }
        : await searchBinanceInstruments(q, 200);

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({ instruments, total, source: market === "forex" ? "oanda" : "binance" });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
