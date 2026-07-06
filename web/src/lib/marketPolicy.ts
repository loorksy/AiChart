import type { MarketType } from "./markets/types";

/** Platform is forex-only. */
export const DEFAULT_MARKET: MarketType = "forex";

export const NON_FOREX_MARKET_MESSAGE =
  "المنصة تدعم الفوركس (MetaTrader) فقط.";

/** Coerces legacy market values to forex for runtime behavior. */
export function resolveActiveMarket(value?: MarketType | string | null): MarketType {
  return value === "forex" ? "forex" : DEFAULT_MARKET;
}

/** Rejects API requests that explicitly target a non-forex market. */
export function rejectNonForexMarket(
  value?: MarketType | string | null,
): string | null {
  if (!value || value === "forex") return null;
  return NON_FOREX_MARKET_MESSAGE;
}
