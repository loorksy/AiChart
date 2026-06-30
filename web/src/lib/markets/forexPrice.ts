import {
  fetchOandaPricing,
  oandaAccountId,
  oandaConfigured,
} from "./oanda";

/** Live mid price for forex — OANDA only (official market-data source). */
export async function getForexLiveMid(
  _userId: number,
  symbol: string,
): Promise<number> {
  if (!oandaConfigured() || !oandaAccountId()) return 0;
  try {
    const [q] = await fetchOandaPricing([symbol]);
    return q?.mid != null && q.mid > 0 ? q.mid : 0;
  } catch {
    return 0;
  }
}
