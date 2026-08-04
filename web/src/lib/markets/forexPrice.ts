import {
  fetchOandaPricing,
  oandaAccountId,
  oandaConfigured,
} from "./oanda";
import { resolveMarketDataSource } from "./marketDataSource";
import { forexCanonicalKey } from "./forexCanonical";
import { resolveBrokerSymbol } from "./symbolCatalogue";

/**
 * Live mid from the trader's resolved market-data pipe.
 * A linked cloud account reads that broker's book — never silently OANDA.
 */
export async function getForexLiveMid(
  userId: number,
  symbol: string,
): Promise<number> {
  const decision = await resolveMarketDataSource(userId, null);
  if (decision.source === "metaapi" && userId > 0) {
    try {
      const { getMtAccount } = await import("@/lib/store");
      const account = await getMtAccount(userId);
      const accountId = account?.metaapi_account_id;
      if (accountId && accountId !== "mt5local") {
        const brokerSymbol = await resolveBrokerSymbol(userId, symbol);
        const { getRpcConnection } = await import("@/lib/metaapi/client");
        const rpc = await getRpcConnection(userId, accountId);
        const price = await rpc.getSymbolPrice(brokerSymbol, false);
        const bid = Number(price?.bid);
        const ask = Number(price?.ask);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          return (bid + ask) / 2;
        }
      }
    } catch {
      /* fall through to platform feed */
    }
  }

  if (!oandaConfigured() || !oandaAccountId()) return 0;
  try {
    const [q] = await fetchOandaPricing([forexCanonicalKey(symbol)]);
    return q?.mid != null && q.mid > 0 ? q.mid : 0;
  } catch {
    return 0;
  }
}
