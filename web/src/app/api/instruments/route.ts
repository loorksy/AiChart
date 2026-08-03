import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey } from "@/lib/api";
import { rejectNonForexMarket } from "@/lib/marketPolicy";
import { forexBaseQuote } from "@/lib/markets/forexInstruments";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isMarketOpenAt } from "@/lib/markets/tradingCalendar";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import {
  fetchOandaInstruments,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
  /** False while the instrument's session is closed — no tape to analyse. */
  market_open: boolean;
}

function symbolMatchesQuery(symbol: string, query: string): boolean {
  if (!query) return true;
  const upper = symbol.toUpperCase();
  if (upper.includes(query)) return true;
  return forexCanonicalKey(symbol) === forexCanonicalKey(query);
}

/** Forex universe from OANDA — official market-data source; execution stays on MT5. */
async function oandaForexInstruments(
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const map = new Map<string, Instrument>();
  const query = q.trim().toUpperCase();
  const now = Date.now();
  const rows = await fetchOandaInstruments();
  for (const row of rows) {
    if (row.type !== "CURRENCY" && row.type !== "METAL") continue;
    const symbol = row.symbol.toUpperCase();
    if (!symbolMatchesQuery(symbol, query)) continue;
    if (!map.has(symbol)) {
      const { base, quote } = forexBaseQuote(symbol);
      map.set(symbol, { symbol, base, quote, market_open: isMarketOpenAt(symbol, now) });
    }
  }
  const instruments = Array.from(map.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
  return { instruments, total: instruments.length };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user && !checkRateLimit(`instruments:${clientKey(request)}`, 40, 60_000)) {
      return NextResponse.json(
        { error: "طلبات كثيرة — سجّل الدخول للمتابعة." },
        { status: 429 },
      );
    }

    const requestedSource = request.nextUrl.searchParams.get("source");
    const decision = await resolveMarketDataSource(user?.id ?? null, requestedSource);

    if (decision.source === "metaapi" && user) {
      // The cloud account's own instrument list — the symbols this trader's
      // orders will actually reference, suffixes and all.
      const { getMtAccount } = await import("@/lib/store");
      const account = await getMtAccount(user.id);
      const accountId = account?.metaapi_account_id;
      if (accountId && accountId !== "mt5local") {
        try {
          const { getRpcConnection } = await import("@/lib/metaapi/client");
          const conn = await getRpcConnection(user.id, accountId);
          const query = (
            request.nextUrl.searchParams.get("q") ??
            request.nextUrl.searchParams.get("search") ??
            ""
          )
            .trim()
            .toUpperCase();
          const all = await conn.getSymbols();
          const rows = (query ? all.filter((sym) => sym.toUpperCase().includes(query)) : all)
            .slice()
            .sort((a, b) => a.localeCompare(b));
          const now = Date.now();
          return NextResponse.json({
            instruments: rows.map((sym) => {
              const { base, quote } = forexBaseQuote(sym);
              return { symbol: sym, base, quote, market_open: isMarketOpenAt(sym, now) };
            }),
            total: rows.length,
            source: "metaapi",
          });
        } catch {
          // Fall through to the platform universe rather than an empty list.
        }
      }
    }

    const q = (
      request.nextUrl.searchParams.get("q") ??
      request.nextUrl.searchParams.get("search") ??
      ""
    ).trim();

    const marketParam = request.nextUrl.searchParams.get("market");
    const marketBlock = rejectNonForexMarket(marketParam);
    if (marketBlock) {
      return NextResponse.json({ error: marketBlock }, { status: 400 });
    }

    const { instruments, total } =
      oandaConfigured() && oandaAccountId()
        ? await oandaForexInstruments(q)
        : { instruments: [], total: 0 };

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      // `sourceReason` lets the client say *why* it is looking at platform
      // pairs rather than its broker's, instead of guessing.
      return NextResponse.json({
        instruments,
        total,
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
