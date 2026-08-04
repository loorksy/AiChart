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
  /**
   * Where this row came from. Broker-seeded symbols must never be labelled as
   * the platform feed — a later user reading OANDA would otherwise think the
   * platform can quote a ticker only Exness lists.
   */
  origin: "oanda" | "broker";
}

function symbolMatchesQuery(symbol: string, query: string): boolean {
  if (!query) return true;
  const upper = symbol.toUpperCase();
  if (upper.includes(query)) return true;
  return forexCanonicalKey(symbol) === forexCanonicalKey(query);
}

function toInstrument(symbol: string, origin: "oanda" | "broker", now: number): Instrument {
  const { base, quote } = forexBaseQuote(symbol);
  return { symbol, base, quote, market_open: isMarketOpenAt(symbol, now), origin };
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
      map.set(symbol, toInstrument(symbol, "oanda", now));
    }
  }
  const instruments = Array.from(map.values()).sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
  return { instruments, total: instruments.length };
}

/** Persisted broker seed — fallback when live getSymbols() is unavailable. */
async function brokerCatalogueInstruments(
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const now = Date.now();
  const rows = await listBrokerCatalogue({ q, limit: 5000 });
  const instruments = rows.map((row) =>
    toInstrument(row.broker_symbol, "broker", now),
  );
  return { instruments, total: instruments.length };
}

/**
 * Platform catalogue with broker-seeded gaps filled in, each row tagged so the
 * UI never presents a broker-only ticker as an OANDA instrument.
 */
async function platformWithBrokerGaps(
  q: string,
): Promise<{ instruments: Instrument[]; total: number }> {
  const oanda = oandaConfigured() && oandaAccountId()
    ? await oandaForexInstruments(q)
    : { instruments: [] as Instrument[], total: 0 };
  const broker = await brokerCatalogueInstruments(q);
  const seen = new Set(
    oanda.instruments.map((row) => forexCanonicalKey(row.symbol)),
  );
  const merged = [...oanda.instruments];
  for (const row of broker.instruments) {
    const key = forexCanonicalKey(row.symbol);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { instruments: merged, total: merged.length };
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
            instruments: rows.map((sym) => toInstrument(sym, "broker", now)),
            total: rows.length,
            source: "metaapi",
            sourceReason: decision.reason,
          });
        } catch {
          // Live RPC failed — serve the persisted broker seed, not OANDA.
          // Labelling these as platform data would be a lie about the book.
          const seeded = await brokerCatalogueInstruments(q);
          if (seeded.total > 0) {
            return NextResponse.json({
              ...seeded,
              source: "metaapi",
              sourceReason: "catalogue_fallback",
            });
          }
        }
      }
    }

    const { instruments, total } = await platformWithBrokerGaps(q);

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
