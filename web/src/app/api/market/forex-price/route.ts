import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  fetchOandaPricing,
  oandaAccountId,
  oandaConfigured,
} from "@/lib/markets/oanda";

function oandaNotConfigured() {
  return NextResponse.json({
    source: "oanda",
    connected: false,
    online: false,
    price: null,
    error: "OANDA غير مُعدّ — أضف OANDA_API_TOKEN و OANDA_ACCOUNT_ID.",
  });
}

/** Live forex price — OANDA only (official market-data source). */
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAccess();
    const symbolsParam = req.nextUrl.searchParams.get("symbols");
    const symbol = (req.nextUrl.searchParams.get("symbol") || "EURUSD")
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, "");

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
        return NextResponse.json({
          source: "oanda",
          connected: true,
          online: q.tradeable,
          symbol,
          price: q.mid,
          bid: q.bid,
          ask: q.ask,
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
