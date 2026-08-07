import { resolveBrokerSymbol } from "./symbolCatalogue";

/**
 * Live mid from the trader's own cloud account — the only book there is.
 * Returns 0 when no account is linked or the quote is unavailable; callers
 * already treat 0 as "no price", and absence is reported as absence.
 */
export async function getForexLiveMid(
  userId: number,
  symbol: string,
): Promise<number> {
  if (!userId || userId <= 0) return 0;
  try {
    const { getMtAccount } = await import("@/lib/store");
    const account = await getMtAccount(userId);
    const accountId = account?.metaapi_account_id;
    if (!accountId || accountId === "mt5local") return 0;
    const brokerSymbol = await resolveBrokerSymbol(userId, symbol);
    const { getRpcConnection } = await import("@/lib/metaapi/client");
    const rpc = await getRpcConnection(userId, accountId);
    const price = await rpc.getSymbolPrice(brokerSymbol, false);
    const bid = Number(price?.bid);
    const ask = Number(price?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask)) {
      return (bid + ask) / 2;
    }
    return 0;
  } catch {
    return 0;
  }
}
