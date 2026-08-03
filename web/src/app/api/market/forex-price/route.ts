import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  fetchOandaPricing,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";
import { getMtAccount } from "@/lib/store";
import { getRpcConnection } from "@/lib/metaapi/client";
import { resolveMarketDataSource } from "@/lib/markets/marketDataSource";
import { spreadFromBidAsk, formatSpreadAr } from "@/lib/spread";

function oandaNotConfigured() {
  return NextResponse.json({
    source: "oanda",
    connected: false,
    online: false,
    price: null,
    error: "OANDA غير مُعدّ — أضف OANDA_API_TOKEN و OANDA_ACCOUNT_ID.",
  });
}

/**
 * The trader's own broker quote, when their account is the active pipe.
 *
 * A cloud account's bid/ask is the only spread that means anything to them —
 * it is what their order will actually cross. The platform feed's spread is
 * OANDA's book, which they will never trade against.
 */
async function cloudQuote(userId: number, symbol: string) {
  const account = await getMtAccount(userId);
  if (!account?.metaapi_account_id || account.metaapi_account_id === "mt5local") {
    return null;
  }
  const rpc = await getRpcConnection(userId, account.metaapi_account_id);
  const price = await rpc.getSymbolPrice(symbol, true);
  const bid = Number(price?.bid);
  const ask = Number(price?.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return { bid, ask, spread: spreadFromBidAsk(bid, ask, symbol) };
}

/** Live forex price — the trader's active market-data pipe. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbolsParam = req.nextUrl.searchParams.get("symbols");
    /*
     * Case preserved: a broker spells XAUUSDm and its quote API is
     * case-sensitive. Uppercasing here asked for an instrument that does not
     * exist, the same way it did for candles.
     */
    const symbolRaw = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");
    const symbol = symbolRaw.toUpperCase();

    // Single-symbol requests follow the resolved pipe; the multi-symbol ticker
    // stays on the platform feed, which answers 50 symbols in one call.
    if (!symbolsParam) {
      const decision = await resolveMarketDataSource(user.id, null);
      if (decision.source === "metaapi") {
        try {
          const q = await cloudQuote(user.id, symbolRaw);
          if (q) {
            return NextResponse.json({
              source: "metaapi",
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
          // Fall through to the platform feed rather than leaving the badge
          // blank: a stale broker connection must not blank the price.
        }
      }
    }

    if (!oandaConfigured() || !oandaAccountId()) {
      if (symbolsParam) {
        return NextResponse.json({ source: "oanda", quotes: [] });
      }
      return oandaNotConfigured();
    }

    if (symbolsParam) {
      const symbols = symbolsParam
        .split(",")
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.]/g, ""))
        .filter(Boolean)
        .slice(0, 50);
      if (symbols.length === 0) {
        return NextResponse.json({ source: "oanda", quotes: [] });
      }
      try {
        const quotes = await fetchOandaPricing(symbols);
        return NextResponse.json({
          source: "oanda",
          quotes: quotes.map((q) => ({
            symbol: q.symbol,
            price: q.mid,
            bid: q.bid,
            ask: q.ask,
            tradeable: q.tradeable,
          })),
          updated_at: new Date().toISOString(),
        });
      } catch {
        return NextResponse.json({ source: "oanda", quotes: [] });
      }
    }

    try {
      const [q] = await fetchOandaPricing([symbol]);
      if (q && q.mid != null) {
        // Same shape from both pipes, so the badge reads one field and the
        // `source` tells the trader whose book the number came from.
        const spread = spreadFromBidAsk(Number(q.bid), Number(q.ask), symbol);
        return NextResponse.json({
          source: "oanda",
          connected: true,
          online: q.tradeable,
          symbol,
          price: q.mid,
          bid: q.bid,
          ask: q.ask,
          spread_raw: spread?.spreadRaw ?? null,
          spread_pips: spread?.spreadPips ?? null,
          spread_label: formatSpreadAr(spread),
          updated_at: new Date().toISOString(),
        });
      }
    } catch {
      /* below */
    }

    return NextResponse.json({
      source: "oanda",
      connected: true,
      online: false,
      symbol,
      price: null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
