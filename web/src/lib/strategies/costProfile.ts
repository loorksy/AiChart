import { getEaLiveQuotes } from "@/lib/eaLiveState";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { spreadFromBidAsk } from "@/lib/spread";
import type { StrategyCostProfile } from "./catalog";

export interface StrategyCostEvidence extends StrategyCostProfile {
  spreadSource:
    | "ea_live_quote"
    | "configured_broker_profile"
    | "research_default_profile";
  slippageSource: "configured_broker_profile" | "spread_stress_model";
  commissionSource: "configured_broker_profile" | "not_recorded";
  quoteAgeMs: number | null;
}

/** Conservative research fallback when no EA quote or BACKTEST_SPREAD_PIPS is set. */
const RESEARCH_DEFAULT_SPREAD_PIPS = 2;

function configuredNumber(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Builds a cost profile from the connected execution broker where possible.
 * Any fallback is explicitly labelled and persisted with the backtest request.
 */
export async function getStrategyCostEvidence(
  userId: number,
  symbol: string,
): Promise<StrategyCostEvidence> {
  const canonical = forexCanonicalKey(symbol);
  const quotes = await getEaLiveQuotes(userId).catch(() => ({}));
  const quote = Object.values(quotes).find(
    (item) => forexCanonicalKey(item.symbol) === canonical,
  );
  const maxAge = Math.max(
    1_000,
    Number(process.env.BACKTEST_COST_QUOTE_MAX_AGE_MS) || 120_000,
  );
  const observed =
    quote && quote.quoteAgeMs <= maxAge
      ? spreadFromBidAsk(Number(quote.bid), Number(quote.ask), canonical)
      : null;
  const configuredSpread = configuredNumber("BACKTEST_SPREAD_PIPS");
  const spreadPips =
    observed?.spreadPips ?? configuredSpread ?? RESEARCH_DEFAULT_SPREAD_PIPS;
  const spreadSource = observed
    ? "ea_live_quote"
    : configuredSpread != null
      ? "configured_broker_profile"
      : "research_default_profile";

  const configuredSlippage = configuredNumber("BACKTEST_SLIPPAGE_PIPS");
  const configuredCommission = configuredNumber(
    "BACKTEST_COMMISSION_PER_LOT_SIDE_USD",
  );
  return {
    spreadPips,
    // A missing slippage series is stressed at half the observed spread.  It
    // is not presented as an observed broker value.
    slippagePips: configuredSlippage ?? spreadPips * 0.5,
    commissionPerLotSideUsd: configuredCommission ?? 0,
    spreadSource,
    slippageSource:
      configuredSlippage == null
        ? "spread_stress_model"
        : "configured_broker_profile",
    commissionSource:
      configuredCommission == null
        ? "not_recorded"
        : "configured_broker_profile",
    quoteAgeMs: quote?.quoteAgeMs ?? null,
  };
}

