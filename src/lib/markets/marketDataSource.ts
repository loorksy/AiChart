/**
 * The one market-data pipe: the trader's own cloud MetaTrader account.
 *
 * The platform no longer carries a proxy feed. Linking a broker account is
 * the platform's first step — candles, quotes and instruments all come over
 * that account's own connection, the market the trader's orders will actually
 * fill against. The decision object survives so every endpoint can keep
 * reporting what it served and — more importantly now — whether the account
 * is linked at all: an unlinked user is GATED to the link flow, never handed
 * a substitute feed.
 */
import { getMtAccount } from "@/lib/store";

export type MarketDataSource = "metaapi";

/** Kept for stored-settings compatibility; every value resolves to metaapi. */
export type MarketDataSourcePreference = MarketDataSource | "auto";

export type MarketDataSourceReason =
  | "no_user"
  | "auto_metaapi"
  | "metaapi_not_connected";

export interface MarketDataSourceAvailability {
  metaapi: boolean;
}

export interface MarketDataSourceDecision {
  source: MarketDataSource;
  reason: MarketDataSourceReason;
  available: MarketDataSourceAvailability;
  preference: MarketDataSourcePreference;
}

/**
 * Whether the user's own MetaTrader link can serve market data right now —
 * a MetaApi cloud account or the self-hosted mt5local bridge both count;
 * both are the user's own account. Connection state only — there is nothing
 * else to fall back to.
 */
export async function marketDataAvailability(
  userId: number | null | undefined,
): Promise<MarketDataSourceAvailability> {
  if (!userId) return { metaapi: false };
  const mt = await getMtAccount(userId).catch(() => null);
  return { metaapi: Boolean(mt?.metaapi_account_id) };
}

/**
 * Resolve the source for one request. `source` is always "metaapi"; the
 * signal callers act on is `available.metaapi` / `reason` — an unlinked
 * account means "link first", and every data endpoint answers with absence
 * plus that reason instead of substituting a feed.
 */
export async function resolveMarketDataSource(
  userId: number | null | undefined,
  _requested?: string | null,
): Promise<MarketDataSourceDecision> {
  if (!userId) {
    return {
      source: "metaapi",
      reason: "no_user",
      available: { metaapi: false },
      preference: "auto",
    };
  }
  const available = await marketDataAvailability(userId);
  return {
    source: "metaapi",
    reason: available.metaapi ? "auto_metaapi" : "metaapi_not_connected",
    available,
    preference: "auto",
  };
}
