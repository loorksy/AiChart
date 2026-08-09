import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser, checkRateLimit, clientKey } from "@/lib/api";
import { rejectNonForexMarket } from "@/lib/marketPolicy";
import { forexBaseQuote } from "@/lib/markets/forexInstruments";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { isMarketOpenAt } from "@/lib/markets/tradingCalendar";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import {
  listBrokerCatalogue,
  seedBrokerSymbols,
} from "@/lib/markets/symbolCatalogue";

interface Instrument {
  symbol: string;
  base: string;
  quote: string;
  /** False while the instrument's session is closed — no tape to analyse. */
  market_open: boolean;
  /** Every row is broker data now — the user's own account or the shared seed. */
  origin: "broker";
}

function toInstrument(symbol: string, now: number): Instrument {
  const { base, quote } = forexBaseQuote(symbol);
  return {
    symbol,
    base,
    quote,
    market_open: isMarketOpenAt(symbol, now),
    origin: "broker",
  };
}

/** Persisted broker seed — fallback when live getSymbols() is unavailable. */
async function brokerCatalogueInstruments(
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const now = Date.now();
  const rows = await listBrokerCatalogue({ q, limit: 5000 });
  const seen = new Set<string>();
  const instruments: Instrument[] = [];
  for (const row of rows) {
    const key = forexCanonicalKey(row.broker_symbol);
    if (seen.has(key)) continue;
    seen.add(key);
    instruments.push(toInstrument(row.broker_symbol, now));
  }
  instruments.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { instruments, total: instruments.length };
}

/**
 * The tradable instrument universe — the user's own broker account when
 * linked (the symbols their orders will actually reference, suffixes and
 * all), the shared broker-seeded catalogue otherwise. There is no platform
 * feed; an empty answer plus `requires_link` tells the client to route the
 * user through the MT link flow.
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

    const decision = await resolveMarketDataSource(user?.id ?? null, null);
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

    if (user && decision.available.metaapi) {
      const { getMtAccount } = await import("@/lib/store");
      const account = await getMtAccount(user.id);
      const accountId = account?.metaapi_account_id;
      if (accountId && accountId !== "mt5local") {
        try {
          const { getRpcConnection } = await import("@/lib/metaapi/client");
          const conn = await getRpcConnection(user.id, accountId);
          const query = q.toUpperCase();
          const all = await conn.getSymbols();
          // Keep the shared seed warm whenever a live list is available.
          void seedBrokerSymbols({
            userId: user.id,
            metaapiAccountId: accountId,
            symbols: Array.isArray(all) ? all : [],
          }).catch(() => undefined);
          const rows = (query ? all.filter((sym) => sym.toUpperCase().includes(query)) : all)
            .slice()
            .sort((a, b) => a.localeCompare(b));
          const now = Date.now();
          return NextResponse.json({
            instruments: rows.map((sym) => toInstrument(sym, now)),
            total: rows.length,
            source: "metaapi",
            sourceReason: decision.reason,
          });
        } catch {
          /* live RPC failed — the persisted broker seed below still answers */
        }
      }
    }

    // The shared broker-seeded catalogue: real broker symbols, populated by
    // every account that has ever linked. Serves browsing before a link and
    // survives a temporarily unreachable RPC after one.
    const { instruments, total } = await brokerCatalogueInstruments(q);

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({
        instruments,
        total,
        source: "metaapi",
        sourceReason: decision.reason,
        ...(user && decision.available.metaapi ? {} : { requires_link: true }),
      });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
