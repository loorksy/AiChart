import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";

const TICKER_24H_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";

type TickerRow = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
};

/** 24h price + change % for USDT pairs (filtered by optional `symbols` comma list). */
export async function GET(req: NextRequest) {
  try {
    await requirePlatformAccess();

    const symbolsParam = req.nextUrl.searchParams.get("symbols");
    const wanted = symbolsParam
      ? new Set(
          symbolsParam
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        )
      : null;

    const res = await fetch(TICKER_24H_URL, { next: { revalidate: 60 } });
    if (!res.ok) {
      throw new Error("تعذّر جلب أسعار السوق من Binance");
    }

    const tickers = (await res.json()) as TickerRow[];
    const out: Record<string, { price: number; changePct: number }> = {};

    for (const t of tickers) {
      if (!t.symbol.endsWith("USDT")) continue;
      if (wanted && !wanted.has(t.symbol)) continue;
      out[t.symbol] = {
        price: Number(t.lastPrice),
        changePct: Number(t.priceChangePercent),
      };
    }

    return NextResponse.json(out);
  } catch (err) {
    return handleError(err);
  }
}
