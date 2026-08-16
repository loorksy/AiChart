import { forexCanonicalKey } from "./forexCanonical";
import { fetchOandaPricing, oandaConfigured } from "./oanda";

export interface LiveForexQuote {
  bid: number;
  ask: number;
  /** Epoch ms the quote was read — the read time, the closest honest stamp. */
  observedAt: number;
}

/**
 * Is this OANDA quote usable as a LIVE price?
 *
 * `tradeable: false` is OANDA saying "this is the last price I remember, the
 * instrument is halted" — which is exactly what it returns all weekend. The
 * flag was parsed into `OandaQuote` and then never read, so Friday's close
 * masqueraded as a live quote everywhere a live quote mattered (G7's
 * revalidation above all). A halted quote is not a price; it is a memory.
 */
export function usableQuote(quote: {
  bid?: number | null;
  ask?: number | null;
  tradeable?: boolean;
}): boolean {
  if (quote.tradeable === false) return false;
  const bid = quote.bid;
  const ask = quote.ask;
  if (bid == null || ask == null) return false;
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid;
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
      if (!quote || !usableQuote(quote)) return null;
      return { bid: quote.bid!, ask: quote.ask!, observedAt: Date.now() };
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
