import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getMtAccount } from "@/lib/store";
import { getRpcConnection } from "@/lib/metaapi/client";
import { resolveBrokerSymbol } from "@/lib/markets/symbolCatalogue";
import { spreadFromBidAsk, formatSpreadAr } from "@/lib/spread";

/** Ticker fan-out over the account RPC; small, so a slow symbol can't stall the strip. */
const TICKER_CONCURRENCY = 6;

function requiresLink(symbol: string) {
  return NextResponse.json({
    source: "metaapi",
    connected: false,
    online: false,
    symbol,
    price: null,
    requires_link: true,
    error: "اربط حساب MetaTrader لعرض أسعار وسيطك — البيانات كلها من حسابك أنت.",
  });
}

/**
 * The trader's own broker quote — the only book there is.
 *
 * A cloud account's bid/ask is the only spread that means anything to them:
 * it is what their order will actually cross. No account linked = no price,
 * reported as exactly that.
 */
async function cloudQuote(userId: number, accountId: string, symbol: string) {
  /*
   * A symbol arriving here can be stale: a browser that cached its last
   * symbol before case-preservation existed stored it fully uppercased
   * ("XAUUSDM"), and no amount of case normalisation recovers a lowercase
   * letter that was never there. The catalogue is the only source of truth
   * for what the broker actually calls this instrument.
   */
  const brokerSymbol = await resolveBrokerSymbol(userId, symbol);
  const rpc = await getRpcConnection(userId, accountId);
  const price = await rpc.getSymbolPrice(brokerSymbol, true);
  const bid = Number(price?.bid);
  const ask = Number(price?.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  return { bid, ask, spread: spreadFromBidAsk(bid, ask, brokerSymbol) };
}

/** Live forex price(s) from the user's own linked MetaTrader account. */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    const symbolsParam = req.nextUrl.searchParams.get("symbols");
    // Case preserved: a broker spells XAUUSDm and its quote API is
    // case-sensitive, the same way it is for candles.
    const symbolRaw = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .trim()
      .replace(/[^A-Za-z0-9._]/g, "");

    const account = await getMtAccount(user.id).catch(() => null);
    const accountId = account?.metaapi_account_id;
    const linked = Boolean(accountId && accountId !== "mt5local");

    // Multi-symbol ticker: fan out over the account RPC with bounded
    // concurrency; failed symbols are simply absent from the answer.
    if (symbolsParam) {
      const symbols = symbolsParam
        .split(",")
        .map((s) => s.trim().replace(/[^A-Za-z0-9._]/g, ""))
        .filter(Boolean)
        .slice(0, 50);
      if (!linked || symbols.length === 0) {
        return NextResponse.json({
          source: "metaapi",
          quotes: [],
          ...(linked ? {} : { requires_link: true }),
        });
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
            const q = await cloudQuote(user.id, accountId!, sym);
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
        source: "metaapi",
        quotes,
        updated_at: new Date().toISOString(),
      });
    }

    if (!linked) return requiresLink(symbolRaw);

    try {
      const q = await cloudQuote(user.id, accountId!, symbolRaw);
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
      /* reported below as offline, not as a substitute feed */
    }

    return NextResponse.json({
      source: "metaapi",
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
