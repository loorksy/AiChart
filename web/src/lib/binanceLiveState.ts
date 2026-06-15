import { getPrice, type BinanceEnv } from "./binance";
import { getBinanceCredentials, getSettings } from "./store";

export interface BinanceLiveQuote {
  symbol: string;
  price: number;
  updatedAt: number;
}

const quotesByUser = new Map<number, Map<string, BinanceLiveQuote>>();
const refreshInFlight = new Map<number, Promise<void>>();
const STALE_MS = 2_000;

function parseAllowedAssets(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((s) => String(s).toUpperCase().trim())
        .filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return ["BTCUSDT", "ETHUSDT"];
}

async function refreshQuotes(userId: number): Promise<void> {
  const creds = await getBinanceCredentials(userId);
  const settings = await getSettings(userId);
  const symbols = parseAllowedAssets(settings.allowed_assets ?? "[]");
  const env: BinanceEnv = creds?.env ?? "prod";

  let map = quotesByUser.get(userId);
  if (!map) {
    map = new Map();
    quotesByUser.set(userId, map);
  }
  const now = Date.now();
  await Promise.all(
    symbols.slice(0, 20).map(async (sym) => {
      try {
        const price = await getPrice(sym, env);
        if (price > 0) {
          map!.set(sym, { symbol: sym, price, updatedAt: now });
        }
      } catch {
        /* skip symbol */
      }
    }),
  );
}

export async function ensureBinanceLiveQuotes(userId: number): Promise<void> {
  const map = quotesByUser.get(userId);
  const now = Date.now();
  const stale =
    !map ||
    map.size === 0 ||
    [...map.values()].some((q) => now - q.updatedAt > STALE_MS);

  if (!stale) return;

  const existing = refreshInFlight.get(userId);
  if (existing) {
    await existing;
    return;
  }

  const job = refreshQuotes(userId).finally(() => {
    refreshInFlight.delete(userId);
  });
  refreshInFlight.set(userId, job);
  await job;
}

export function getBinanceLiveQuotes(
  userId: number,
): Record<string, BinanceLiveQuote & { quoteAgeMs: number }> {
  const map = quotesByUser.get(userId);
  const out: Record<string, BinanceLiveQuote & { quoteAgeMs: number }> = {};
  if (!map) return out;
  const now = Date.now();
  for (const [key, q] of map) {
    out[key] = { ...q, quoteAgeMs: now - q.updatedAt };
  }
  return out;
}

export async function getBinanceLivePrice(
  userId: number,
  symbol: string,
): Promise<{ price: number; quoteAgeMs: number } | null> {
  await ensureBinanceLiveQuotes(userId);
  const q = quotesByUser.get(userId)?.get(symbol.toUpperCase());
  if (!q || q.price <= 0) return null;
  return { price: q.price, quoteAgeMs: Date.now() - q.updatedAt };
}
