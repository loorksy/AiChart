import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/api";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";
import { forexBaseQuote } from "@/lib/markets/forexInstruments";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
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
    await requirePlatformAccess();
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
