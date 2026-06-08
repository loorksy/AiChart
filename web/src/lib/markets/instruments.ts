import { PUBLIC_DATA_URLS } from "../binance";

export interface UsdtInstrument {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

let cache: { at: number; items: UsdtInstrument[] } | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** Lists TRADING Binance spot pairs quoted in USDT. */
export async function listUsdtInstruments(): Promise<UsdtInstrument[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;

  const base = PUBLIC_DATA_URLS.prod;
  const res = await fetch(`${base}/api/v3/exchangeInfo`, { cache: "no-store" });
  if (!res.ok) throw new Error("تعذّر جلب قائمة أزواج Binance.");
  const data = (await res.json()) as {
    symbols: {
      symbol: string;
      status: string;
      baseAsset: string;
      quoteAsset: string;
    }[];
  };

  const items = (data.symbols ?? [])
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.quoteAsset === "USDT" &&
        s.symbol.endsWith("USDT"),
    )
    .map((s) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
    }))
    .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));

  cache = { at: Date.now(), items };
  return items;
}

/** Filters instruments by symbol or base asset prefix (case-insensitive). */
export function searchInstruments(
  items: UsdtInstrument[],
  query?: string,
  limit = 100,
): UsdtInstrument[] {
  const q = query?.trim().toUpperCase();
  if (!q) return items.slice(0, limit);
  return items
    .filter(
      (i) =>
        i.symbol.includes(q) ||
        i.baseAsset.startsWith(q) ||
        i.baseAsset.includes(q),
    )
    .slice(0, limit);
}
