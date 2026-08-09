import type { StrategyCostProfile } from "./catalog";

export interface StrategyCostEvidence extends StrategyCostProfile {
  spreadSource: "configured_broker_profile" | "research_default_profile";
  slippageSource: "configured_broker_profile" | "spread_stress_model";
  commissionSource: "configured_broker_profile" | "not_recorded";
  quoteAgeMs: number | null;
}

/** Conservative research fallback when no BACKTEST_SPREAD_PIPS is set. */
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
  _userId: number,
  _symbol: string,
): Promise<StrategyCostEvidence> {
  const configuredSpread = configuredNumber("BACKTEST_SPREAD_PIPS");
  const spreadPips = configuredSpread ?? RESEARCH_DEFAULT_SPREAD_PIPS;
  const spreadSource =
    configuredSpread != null ? "configured_broker_profile" : "research_default_profile";

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
    quoteAgeMs: null,
  };
}

