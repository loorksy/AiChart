import { defaultKlineLimit } from "@/lib/ohlc/klineLimits";
import { ohlcCacheTtlMs } from "@/lib/markets/intervals";

export interface ClientKlineBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const store = new Map<string, { candles: ClientKlineBar[]; at: number }>();

export function klinesClientKey(
  symbol: string,
  interval: string,
  market: string,
): string {
  return `${market}:${symbol.toUpperCase()}:${interval}`;
}

/** Interval-aware TTL derived from the key (`market:SYMBOL:interval`). */
function ttlForKey(key: string): number {
  const interval = key.split(":")[2] ?? "";
  return ohlcCacheTtlMs(interval);
}

export function getKlinesClientCache(key: string): ClientKlineBar[] | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlForKey(key)) {
    store.delete(key);
    return null;
  }
  return hit.candles;
}

export function setKlinesClientCache(key: string, candles: ClientKlineBar[]): void {
  if (!candles.length) return;
  store.set(key, { candles, at: Date.now() });
}

/** Fire-and-forget warm-up — populates client cache before the chart mounts. */
export function prefetchKlines(
  symbol: string,
  interval: string,
  market: "forex" = "forex",
  limit?: number,
): void {
  const key = klinesClientKey(symbol, interval, market);
  if (getKlinesClientCache(key)) return;
  const n = limit ?? defaultKlineLimit(interval, market);
  void fetch(
    `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${market}&limit=${n}`,
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.candles?.length) {
        setKlinesClientCache(key, data.candles as ClientKlineBar[]);
      }
    })
    .catch(() => {});
}
