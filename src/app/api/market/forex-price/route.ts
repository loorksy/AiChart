import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { fetchOandaPricing, oandaConfigured } from "@/lib/markets/oanda";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { TRADABLE_SYMBOLS } from "@/lib/markets/forexInstruments";
import { spreadFromBidAsk, formatSpreadAr } from "@/lib/spread";

const TRADABLE_SET = new Set(TRADABLE_SYMBOLS.map((s) => forexCanonicalKey(s)));
/** Ticker fan-out over OANDA pricing; small, so a slow symbol can't stall the strip. */
const TICKER_CONCURRENCY = 6;

function unavailable(symbol: string) {
  return NextResponse.json({
    source: "oanda",
    connected: false,
    online: false,
    symbol,
    price: null,
    error: "بيانات السوق غير متاحة حاليًا — تعذّر الاتصال بمزوّد البيانات.",
  });
}

/**
 * The platform's OANDA quote — the only book there is. No account link is
 * required or consulted; this is platform-level market data.
 */
async function oandaQuote(symbol: string) {
  const canonical = forexCanonicalKey(symbol) || symbol;
  if (!TRADABLE_SET.has(canonical)) return null;
  const [q] = await fetchOandaPricing([canonical]);
  if (!q || q.bid == null || q.ask == null) return null;
  const bid = q.bid;
  const ask = q.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return { bid, ask, spread: spreadFromBidAsk(bid, ask, canonical) };
}

/** Live forex price(s) from the platform's OANDA feed. */
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAccess();
    const symbolsParam = req.nextUrl.searchParams.get("symbols");
    const symbolRaw = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");

    const configured = oandaConfigured();

    // Multi-symbol ticker: fan out over OANDA pricing with bounded concurrency;
    // failed symbols are simply absent from the answer.
    if (symbolsParam) {
      const symbols = symbolsParam
        .split(",")
        .map((s) => s.trim().replace(/[^A-Za-z0-9._]/g, ""))
        .filter(Boolean)
        .slice(0, 50);
      if (!configured || symbols.length === 0) {
        return NextResponse.json({ source: "oanda", quotes: [] });
      }
      const quotes: Array<{
        symbol: string;
        price: number;
        bid: number;
        ask: number;
        tradeable: boolean;
      }> = [];
      for (let i = 0; i < symbols.length; i += TICKER_CONCURRENCY) {
        const batch = symbols.slice(i, i + TICKER_CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map(async (sym) => {
            const q = await oandaQuote(sym);
            if (!q) return null;
            return {
              symbol: sym,
              price: q.spread?.mid ?? (q.bid + q.ask) / 2,
              bid: q.bid,
              ask: q.ask,
              tradeable: true,
            };
          }),
        );
        for (const s of settled) {
          if (s.status === "fulfilled" && s.value) quotes.push(s.value);
        }
      }
      return NextResponse.json({
        source: "oanda",
        quotes,
        updated_at: new Date().toISOString(),
      });
    }

    if (!configured) return unavailable(symbolRaw);

    try {
      const q = await oandaQuote(symbolRaw);
      if (q) {
        return NextResponse.json({
          source: "oanda",
          connected: true,
          online: true,
          symbol: symbolRaw,
          price: q.spread?.mid ?? (q.bid + q.ask) / 2,
          bid: q.bid,
          ask: q.ask,
          spread_raw: q.spread?.spreadRaw ?? null,
          spread_pips: q.spread?.spreadPips ?? null,
          spread_label: formatSpreadAr(q.spread),
          updated_at: new Date().toISOString(),
        });
      }
    } catch {
      /* reported below as offline, not as a substitute feed */
    }

    return NextResponse.json({
      source: "oanda",
      connected: true,
      online: false,
      symbol: symbolRaw,
      price: null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
