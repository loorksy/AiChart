/**
 * Which of the three pipes serves a user's market data.
 *
 *  - **OANDA** is the platform's own feed. It always works, for everyone,
 *    connected or not, and it is what everything falls back to.
 *  - **The EA bridge** is the trader's own MetaTrader terminal answering
 *    queued commands. Only an account with a live EA can serve candles or its
 *    symbol universe this way.
 *  - **MetaApi** is the same trader's cloud MetaTrader account. Its history
 *    comes over the account's own RPC connection — the broker's candles, the
 *    ones their orders will fill against.
 *
 * The UI cannot tell these apart on its own, and asking it to is how
 * `source=ea` ended up being sent for MetaApi accounts, where every EA command
 * waits out its full timeout and then returns nothing. So the decision is made
 * here, on the server, from what is actually connected plus the user's own
 * choice — and every endpoint reports the source it really served.
 *
 * The default, with no choice stored: the cloud account when it is linked,
 * then the user's own terminal, then the platform feed. A trader who links a
 * broker account means to see that broker's market.
 */
import { getEaConnection } from "@/lib/eaStore";
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";
import { getMtAccount, getSettings } from "@/lib/store";

export type MarketDataSource = "oanda" | "ea" | "metaapi";

/** What the user asked for. `auto` (or nothing stored) applies the default. */
export type MarketDataSourcePreference = MarketDataSource | "auto";

export type MarketDataSourceReason =
  | "platform_requested"
  | "oanda_data_only"
  | "no_user"
  | "user_choice"
  | "auto_metaapi"
  | "auto_ea"
  | "auto_oanda"
  | "ea_not_connected"
  | "metaapi_not_connected";

export interface MarketDataSourceAvailability {
  oanda: boolean;
  ea: boolean;
  metaapi: boolean;
}

export interface MarketDataSourceDecision {
  source: MarketDataSource;
  reason: MarketDataSourceReason;
  available: MarketDataSourceAvailability;
  /** The stored preference, so a UI can show what is pinned vs. derived. */
  preference: MarketDataSourcePreference;
}

const NOTHING_CONNECTED: MarketDataSourceAvailability = {
  oanda: true,
  ea: false,
  metaapi: false,
};

/** Which pipes could serve this user right now. */
export async function marketDataAvailability(
  userId: number | null | undefined,
): Promise<MarketDataSourceAvailability> {
  if (!userId || isOandaDataOnly()) return NOTHING_CONNECTED;
  const [ea, mt] = await Promise.all([
    getEaConnection(userId).catch(() => null),
    getMtAccount(userId).catch(() => null),
  ]);
  return {
    oanda: true,
    ea: Boolean(ea && ea.status !== "revoked"),
    metaapi: Boolean(
      mt?.metaapi_account_id && mt.metaapi_account_id !== "mt5local",
    ),
  };
}

function normalizePreference(raw: string | null | undefined): MarketDataSourcePreference {
  return raw === "oanda" || raw === "ea" || raw === "metaapi" ? raw : "auto";
}

/**
 * Resolve the source for one request.
 *
 * `requested` is an explicit per-request override (the chart carrying the
 * source its symbol came from); when absent the user's stored preference
 * decides, and when that is `auto` — or names a pipe that is not connected —
 * the default order applies. It never returns a source that cannot answer, so
 * a caller never waits on a terminal that is not there.
 */
export async function resolveMarketDataSource(
  userId: number | null | undefined,
  requested?: string | null,
): Promise<MarketDataSourceDecision> {
  if (isOandaDataOnly()) {
    return {
      source: "oanda",
      reason: "oanda_data_only",
      available: NOTHING_CONNECTED,
      preference: "auto",
    };
  }
  if (!userId) {
    return {
      source: "oanda",
      reason: "no_user",
      available: NOTHING_CONNECTED,
      preference: "auto",
    };
  }

  const [available, settings] = await Promise.all([
    marketDataAvailability(userId),
    getSettings(userId).catch(() => null),
  ]);
  const preference = normalizePreference(settings?.market_data_source);
  const wanted = normalizePreference(requested) === "auto"
    ? preference
    : normalizePreference(requested);

  if (wanted === "oanda") {
    return { source: "oanda", reason: "platform_requested", available, preference };
  }
  if (wanted === "ea") {
    return available.ea
      ? { source: "ea", reason: "user_choice", available, preference }
      : { source: "oanda", reason: "ea_not_connected", available, preference };
  }
  if (wanted === "metaapi") {
    return available.metaapi
      ? { source: "metaapi", reason: "user_choice", available, preference }
      : { source: "oanda", reason: "metaapi_not_connected", available, preference };
  }

  // auto — the cloud account first, because linking one is a statement about
  // which market the trader wants to see.
  if (available.metaapi) {
    return { source: "metaapi", reason: "auto_metaapi", available, preference };
  }
  if (available.ea) {
    return { source: "ea", reason: "auto_ea", available, preference };
  }
  return { source: "oanda", reason: "auto_oanda", available, preference };
}
