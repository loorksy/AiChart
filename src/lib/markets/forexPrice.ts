import { forexCanonicalKey } from "./forexCanonical";
import { fetchOandaPricing, oandaConfigured } from "./oanda";

export interface LiveForexQuote {
  bid: number;
  ask: number;
  /** Epoch ms the quote was read — the read time, the closest honest stamp. */
  observedAt: number;
}

/**
 * Live bid/ask from the platform's OANDA feed — the same call the
 * forex-price ticker route makes, so the analysis pipeline and the UI strip
 * read the identical book. Bounded by `timeoutMs` and null on ANY failure
 * (not configured, HTTP error, timeout): absence degrades silently to the
 * caller's fallback ladder, it is never fabricated. No account is consulted
 * — OANDA is platform-level data, not user-linked.
 */
export async function getForexLiveQuote(
  _userId: number,
  symbol: string,
  options?: { timeoutMs?: number },
): Promise<LiveForexQuote | null> {
  const timeoutMs = options?.timeoutMs ?? 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchQuote = (async (): Promise<LiveForexQuote | null> => {
      if (!oandaConfigured()) return null;
      const canonical = forexCanonicalKey(symbol) || symbol;
      const [quote] = await fetchOandaPricing([canonical]);
      if (!quote || quote.bid == null || quote.ask == null) return null;
      const bid = quote.bid;
      const ask = quote.ask;
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
        return null;
      }
      return { bid, ask, observedAt: Date.now() };
    })();
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([fetchQuote.catch(() => null), expired]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Live mid from the platform's OANDA feed. Returns 0 when OANDA isn't
 * configured or the quote is unavailable; callers already treat 0 as "no
 * price", and absence is reported as absence.
 */
export async function getForexLiveMid(
  userId: number,
  symbol: string,
): Promise<number> {
  const quote = await getForexLiveQuote(userId, symbol, { timeoutMs: 15_000 });
  return quote ? (quote.bid + quote.ask) / 2 : 0;
}
