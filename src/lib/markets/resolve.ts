import { DEFAULT_MARKET } from "../marketPolicy";
import type { MarketType, ResolvedSymbol } from "./types";
import { DATA_SYMBOL, DISPLAY_NAME_AR, coerceToGold } from "@/lib/gold";

/**
 * Symbol resolution on a single-instrument platform.
 *
 * Every query resolves to gold. This is the permissive (UI-facing) resolver:
 * a stale bookmark, a cached client symbol, or free text the user typed all
 * land on the one instrument that exists rather than erroring. Server-side
 * data paths use `requireGold` from lib/gold.ts instead, which throws.
 */
export function resolveSymbol(
  query: string,
  market: MarketType = DEFAULT_MARKET,
): ResolvedSymbol {
  void market;
  return {
    raw: query,
    symbol: coerceToGold(query),
    market: "forex",
    displayName: DISPLAY_NAME_AR,
  };
}

/** Recommendation/intent symbol — always the canonical gold key. */
export function normalizeIntentSymbol(
  _symbol: string,
  _market: MarketType = DEFAULT_MARKET,
): string {
  return DATA_SYMBOL;
}

export function marketLabel(_market: MarketType = DEFAULT_MARKET): string {
  return "الذهب";
}
