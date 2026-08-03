/**
 * Which of the two pipes serves a user's market data.
 *
 *  - **OANDA** is the platform's own feed. It always works, for everyone,
 *    connected or not, and it is what everything falls back to.
 *  - **MetaApi** is the trader's cloud MetaTrader account. Its history comes
 *    over the account's own RPC connection — the broker's candles, the ones
 *    their orders will fill against.
 *
 * The UI cannot tell these apart on its own, so the decision is made here, on
 * the server, from what is actually connected plus the user's own choice —
 * and every endpoint reports the source it really served.
 *
 * The default, with no choice stored: the cloud account when it is linked,
 * otherwise the platform feed. A trader who links a broker account means to
 * see that broker's market.
 */
import { isOandaDataOnly } from "@/lib/markets/forexDataSource";
import { getMtAccount, getSettings } from "@/lib/store";

export type MarketDataSource = "oanda" | "metaapi";

/** What the user asked for. `auto` (or nothing stored) applies the default. */
export type MarketDataSourcePreference = MarketDataSource | "auto";

export type MarketDataSourceReason =
  | "platform_requested"
  | "oanda_data_only"
  | "no_user"
  | "user_choice"
  | "auto_metaapi"
  | "auto_oanda"
  | "metaapi_not_connected";

export interface MarketDataSourceAvailability {
  oanda: boolean;
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
  metaapi: false,
};

/**
 * Which pipes could serve this user right now.
 *
 * Connection state only. FOREX_DATA_SOURCE used to short-circuit this, which
 * made every non-OANDA row in the picker permanently grey — and grey with the
 * wrong explanation, since the UI reads unavailability as "you have not linked
 * this yet". The deployment default belongs in the `auto` branch below, not in
 * an answer about what the account has connected.
 */
export async function marketDataAvailability(
  userId: number | null | undefined,
): Promise<MarketDataSourceAvailability> {
  if (!userId) return NOTHING_CONNECTED;
  const mt = await getMtAccount(userId).catch(() => null);
  return {
    oanda: true,
    metaapi: Boolean(
      mt?.metaapi_account_id && mt.metaapi_account_id !== "mt5local",
    ),
  };
}

function normalizePreference(raw: string | null | undefined): MarketDataSourcePreference {
  return raw === "oanda" || raw === "metaapi" ? raw : "auto";
}

/**
 * Resolve the source for one request.
 *
 * `requested` is an explicit per-request override (the chart carrying the
 * source its symbol came from); when absent the user's stored preference
 * decides, and when that is `auto` — or names a pipe that is not connected —
 * the default order applies. It never returns a source that cannot answer, so
 * a caller never waits on a connection that is not there.
 */
export async function resolveMarketDataSource(
  userId: number | null | undefined,
  requested?: string | null,
): Promise<MarketDataSourceDecision> {
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
  if (wanted === "metaapi") {
    return available.metaapi
      ? { source: "metaapi", reason: "user_choice", available, preference }
      : { source: "oanda", reason: "metaapi_not_connected", available, preference };
  }

  // auto — with no choice of their own, the deployment default decides. This is
  // where FOREX_DATA_SOURCE belongs: it sets what happens by default, and does
  // not overrule a trader who has picked a pipe their account is connected to.
  if (isOandaDataOnly()) {
    return { source: "oanda", reason: "oanda_data_only", available, preference };
  }
  // The cloud account first, because linking one is a statement about which
  // market the trader wants to see.
  if (available.metaapi) {
    return { source: "metaapi", reason: "auto_metaapi", available, preference };
  }
  return { source: "oanda", reason: "auto_oanda", available, preference };
}
