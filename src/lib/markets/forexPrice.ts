import { resolveBrokerSymbol } from "./symbolCatalogue";

export interface LiveForexQuote {
  bid: number;
  ask: number;
  /** Epoch ms the quote was read — the read time, the closest honest stamp. */
  observedAt: number;
}

/**
 * Live bid/ask from the trader's own cloud account — the same call the
 * forex-price ticker route makes, so the analysis pipeline and the UI strip
 * read the identical book. Bounded by `timeoutMs` and null on ANY failure
 * (no account, mt5local, RPC error, timeout): absence degrades silently to
 * the caller's fallback ladder, it is never fabricated.
 */
export async function getForexLiveQuote(
  userId: number,
  symbol: string,
  options?: { timeoutMs?: number },
): Promise<LiveForexQuote | null> {
  if (!userId || userId <= 0) return null;
  const timeoutMs = options?.timeoutMs ?? 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fetchQuote = (async (): Promise<LiveForexQuote | null> => {
      const { getMtAccount } = await import("@/lib/store");
      const account = await getMtAccount(userId);
      const accountId = account?.metaapi_account_id;
      if (!accountId || accountId === "mt5local") return null;
      const brokerSymbol = await resolveBrokerSymbol(userId, symbol);
      const { getRpcConnection } = await import("@/lib/metaapi/client");
      const rpc = await getRpcConnection(userId, accountId);
      const price = await rpc.getSymbolPrice(brokerSymbol, true);
      const bid = Number(price?.bid);
      const ask = Number(price?.ask);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
        return null;
      }
      return { bid, ask, observedAt: Date.now() };
    })();
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    // The losing fetch is left to settle in the background; its RPC connection
    // is the shared per-user singleton, so nothing leaks by abandoning it.
    return await Promise.race([fetchQuote.catch(() => null), expired]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Live mid from the trader's own cloud account — the only book there is.
 * Returns 0 when no account is linked or the quote is unavailable; callers
 * already treat 0 as "no price", and absence is reported as absence.
 */
export async function getForexLiveMid(
  userId: number,
  symbol: string,
): Promise<number> {
  const quote = await getForexLiveQuote(userId, symbol, { timeoutMs: 15_000 });
  return quote ? (quote.bid + quote.ask) / 2 : 0;
}
