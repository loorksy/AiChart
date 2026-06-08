import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api";

const BINANCE_URL = "https://data-api.binance.vision/api/v3/exchangeInfo";

interface BinanceSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
}

let cache: { symbols: BinanceSymbol[]; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

async function loadSymbols(): Promise<BinanceSymbol[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.symbols;
  }
  const res = await fetch(BINANCE_URL, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error("تعذّر جلب أزواج Binance");
  }
  const data = (await res.json()) as { symbols: BinanceSymbol[] };
  const symbols = data.symbols.filter(
    (s) =>
      s.status === "TRADING" &&
      s.quoteAsset === "USDT" &&
      s.isSpotTradingAllowed,
  );
  cache = { symbols, at: Date.now() };
  return symbols;
}

export async function GET(request: NextRequest) {
  try {
    await requireUser();
    const q = (
      request.nextUrl.searchParams.get("q") ??
      request.nextUrl.searchParams.get("search") ??
      ""
    )
      .trim()
      .toUpperCase();
    const symbols = await loadSymbols();

    let filtered = symbols;
    if (q) {
      filtered = symbols.filter(
        (s) =>
          s.symbol.includes(q) ||
          s.baseAsset.includes(q.replace("USDT", "")),
      );
    }

    const instruments = filtered.slice(0, 200).map((s) => ({
      symbol: s.symbol,
      base: s.baseAsset,
      quote: s.quoteAsset,
    }));

    const wrapped = request.nextUrl.searchParams.get("wrapped") === "1";
    if (wrapped) {
      return NextResponse.json({ instruments, total: filtered.length });
    }
    return NextResponse.json(instruments);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ";
    const status = msg.includes("غير مصرّح") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
