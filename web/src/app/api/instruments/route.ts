import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { searchBinanceInstruments } from "@/lib/binanceSymbols";
import {
  forexBaseQuote,
  searchForexInstruments,
} from "@/lib/markets/forexInstruments";
import { getEaConnection, parseEaSymbolSpecs } from "@/lib/eaStore";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
}

async function forexInstruments(
  userId: number,
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const map = new Map<string, Instrument>();
  for (const i of searchForexInstruments(q)) {
    map.set(i.symbol, { symbol: i.symbol, base: i.base, quote: i.quote });
  }

  // Merge symbols actually offered by the user's broker (from EA heartbeat).
  const conn = await getEaConnection(userId);
  if (conn) {
    const query = q.trim().toUpperCase();
    for (const spec of parseEaSymbolSpecs(conn.symbol_specs_json)) {
      const symbol = (spec.symbol || "").toUpperCase();
      if (!symbol) continue;
      if (query && !symbol.includes(query)) continue;
      if (!map.has(symbol)) {
        const { base, quote } = forexBaseQuote(symbol);
        map.set(symbol, { symbol, base, quote });
      }
    }
  }

  const instruments = Array.from(map.values());
  return { instruments, total: instruments.length };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
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
        ? await forexInstruments(user.id, q)
        : await searchBinanceInstruments(q, 200);

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({ instruments, total });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
