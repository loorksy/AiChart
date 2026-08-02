/**
 * Which source may actually serve a user's market data.
 *
 * Three things can be connected to an account and they are not
 * interchangeable:
 *
 *  - **OANDA** is the platform's own market data. It always works, for every
 *    user, connected or not, and it is what the chart falls back to.
 *  - **The EA bridge** is the trader's own MetaTrader terminal answering
 *    queued commands. Only an EA-backed account can serve candles or its
 *    symbol universe this way.
 *  - **MetaApi / the self-hosted MT5 bridge** are execution backends. The
 *    account is genuinely connected, but no EA is running to answer a queued
 *    `get_ohlc` or `list_symbols`.
 *
 * The UI only knows "a broker is online" — it cannot tell which of the three
 * it is, and it should not have to. Asking the client to encode that rule is
 * how `source=ea` ended up being sent for MetaApi accounts, where every EA
 * command waits out its full timeout (15s a page for symbols, 20s a batch for
 * candles) and then returns nothing. So the decision is made here, on the
 * server, and every endpoint reports the source it actually served.
 */
import { getEaConnection } from "@/lib/eaStore";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";
import { resolveForexBackendForUser } from "@/lib/store";

export type MarketDataSource = "oanda" | "ea";

export type MarketDataSourceReason =
  | "platform_requested"
  | "oanda_data_only"
  | "no_user"
  | "backend_not_ea"
  | "ea_not_connected"
  | "ea";

export interface MarketDataSourceDecision {
  source: MarketDataSource;
  reason: MarketDataSourceReason;
}

/**
 * Resolve the source for a request that asked for broker data.
 *
 * Falls back to OANDA — never to an empty result — whenever the EA bridge
 * cannot answer, so a MetaApi or MT5-bridge user sees the platform's pairs and
 * prices instead of a spinner that resolves into nothing.
 */
export async function resolveMarketDataSource(
  userId: number | null | undefined,
  requested: string | null | undefined,
): Promise<MarketDataSourceDecision> {
  if (requested !== "ea") return { source: "oanda", reason: "platform_requested" };
  if (isOandaDataOnly()) return { source: "oanda", reason: "oanda_data_only" };
  if (!userId) return { source: "oanda", reason: "no_user" };

  const backend = await resolveForexBackendForUser(userId).catch(() => "ea" as const);
  if (backend !== "ea") return { source: "oanda", reason: "backend_not_ea" };

  const connection = await getEaConnection(userId).catch(() => null);
  if (!connection || connection.status === "revoked") {
    return { source: "oanda", reason: "ea_not_connected" };
  }
  return { source: "ea", reason: "ea" };
}
