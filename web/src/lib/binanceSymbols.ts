const BINANCE_URL = "https://data-api.binance.vision/api/v3/exchangeInfo";
const TICKER_24H_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";

interface BinanceSymbolRow {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  isSpotTradingAllowed: boolean;
}

let cache: { symbols: string[]; at: number } | null = null;
let topVolumeCache: { symbols: string[]; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** All active Binance Spot USDT pairs (cached ~1h, refreshes with new listings). */
export async function getBinanceUsdtSpotSymbols(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.symbols;
  }

  const res = await fetch(BINANCE_URL, { next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error("تعذّر جلب أزواج Binance");
  }

  const data = (await res.json()) as { symbols: BinanceSymbolRow[] };
  const symbols = data.symbols
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        s.isSpotTradingAllowed,
    )
    .map((s) => s.symbol)
    .sort();

  cache = { symbols, at: Date.now() };
  return symbols;
}

/** Top USDT spot pairs by 24h quote volume (for bounded 24/7 scans). */
export async function getTopUsdtSpotSymbolsByVolume(limit = 40): Promise<string[]> {
  if (topVolumeCache && Date.now() - topVolumeCache.at < CACHE_MS) {
    return topVolumeCache.symbols.slice(0, limit);
  }

  const [tickerRes, allowed] = await Promise.all([
    fetch(TICKER_24H_URL, { next: { revalidate: 3600 } }),
    getBinanceUsdtSpotSymbols(),
  ]);
  if (!tickerRes.ok) {
    throw new Error("تعذّر جلب أحجام التداول من Binance");
  }

  const allowedSet = new Set(allowed);
  const tickers = (await tickerRes.json()) as Array<{
    symbol: string;
    quoteVolume: string;
  }>;
  const ranked = tickers
    .filter((t) => allowedSet.has(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .map((t) => t.symbol);

  topVolumeCache = { symbols: ranked, at: Date.now() };
  return ranked.slice(0, limit);
}

export interface BinanceInstrument {
  symbol: string;
  base: string;
  quote: string;
}

/** Searchable instrument list for UI pickers. */
export async function searchBinanceInstruments(
  query = "",
  limit = 200,
): Promise<{ instruments: BinanceInstrument[]; total: number }> {
  const q = query.trim().toUpperCase();
  const symbols = await getBinanceUsdtSpotSymbols();

  let filtered = symbols;
  if (q) {
    filtered = symbols.filter(
      (sym) =>
        sym.includes(q) || sym.replace(/USDT$/, "").includes(q.replace(/USDT$/, "")),
    );
  }

  const slice = filtered.slice(0, limit);
  return {
    total: filtered.length,
    instruments: slice.map((symbol) => ({
      symbol,
      base: symbol.replace(/USDT$/, ""),
      quote: "USDT",
    })),
  };
}
