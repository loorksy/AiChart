/**
 * The one market-data pipe: OANDA, at the platform level.
 *
 * A single platform-owned OANDA account/token (see markets/oanda.ts) serves
 * quotes, candles and the instrument universe to every user — no end user
 * links anything to see data, charts, or recommendations. A later broker
 * account link is a separate step and plays no role in what market data is
 * available. The decision object survives so every endpoint can
 * keep reporting what it served and whether OANDA itself is configured —
 * an unconfigured platform is GATED to that, never handed a substitute feed.
 */
import { oandaConfigured } from "@/lib/markets/oanda";

export type MarketDataSource = "oanda";

/** Kept for stored-settings compatibility; every value resolves to oanda. */
export type MarketDataSourcePreference = MarketDataSource | "auto";

export type MarketDataSourceReason = "auto_oanda" | "oanda_not_configured";

export interface MarketDataSourceAvailability {
  oanda: boolean;
}

export interface MarketDataSourceDecision {
  source: MarketDataSource;
  reason: MarketDataSourceReason;
  available: MarketDataSourceAvailability;
  preference: MarketDataSourcePreference;
}

/**
 * Whether the platform's OANDA feed can serve market data right now.
 * Platform-level configuration only — not user-specific, not connection
 * state of any individual account.
 */
export async function marketDataAvailability(
  _userId?: number | null,
): Promise<MarketDataSourceAvailability> {
  return { oanda: oandaConfigured() };
}

/**
 * Resolve the source for one request. `source` is always "oanda"; the
 * signal callers act on is `available.oanda` / `reason` — an unconfigured
 * platform means "OANDA isn't set up", not "this user hasn't linked
 * anything". No user identity or broker link affects this decision.
 */
export async function resolveMarketDataSource(
  _userId?: number | null,
  _requested?: string | null,
): Promise<MarketDataSourceDecision> {
  const available = await marketDataAvailability();
  return {
    source: "oanda",
    reason: available.oanda ? "auto_oanda" : "oanda_not_configured",
    available,
    preference: "auto",
  };
}
