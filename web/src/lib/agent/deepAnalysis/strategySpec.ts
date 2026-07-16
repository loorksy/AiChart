/**
 * Build a reusable, generalizable Strategy Specification for Deep Analysis.
 * Never construct a backtest from current numeric entry/SL/TP alone.
 */
import type { ResearchJsonObject } from "@/lib/research/types";

export interface StrategySpecBuildInput {
  symbol: string;
  timeframe: string;
  direction: "buy" | "sell";
  /** Market regime label from detectors (e.g. trending / ranging). */
  marketRegime?: string | null;
  /** Structure bias (e.g. bullish / bearish / mixed). */
  structureBias?: string | null;
  /** Zone type near entry (demand / supply / none). */
  zoneType?: "demand" | "supply" | "none" | null;
  /** Confirmation / setup type from the playbook. */
  confirmationRule?: string | null;
  session?: string | null;
  /** ATR at decision time — used only to derive relative stop/target multiples. */
  atr?: number | null;
  entry?: number | null;
  stopLoss?: number | null;
  targets?: number[] | null;
  invalidationLevel?: number | null;
}

export type StrategySpecBuildResult =
  | {
      ok: true;
      strategySpec: ResearchJsonObject;
      fingerprint: string;
    }
  | {
      ok: false;
      reason: "setup_not_generalizable";
      detail: string;
    };

function relStopAtr(
  entry: number,
  stop: number,
  atr: number,
): number | null {
  if (!(atr > 0) || !(entry > 0) || !(stop > 0)) return null;
  const dist = Math.abs(entry - stop);
  const mult = dist / atr;
  if (!Number.isFinite(mult) || mult < 0.2 || mult > 8) return null;
  return Math.round(mult * 100) / 100;
}

function relTargetsAtr(
  entry: number,
  targets: number[],
  atr: number,
  direction: "buy" | "sell",
): number[] {
  if (!(atr > 0) || !(entry > 0)) return [];
  const out: number[] = [];
  for (const t of targets.slice(0, 3)) {
    if (!(t > 0)) continue;
    const dist = direction === "buy" ? t - entry : entry - t;
    if (dist <= 0) continue;
    const mult = dist / atr;
    if (!Number.isFinite(mult) || mult < 0.3 || mult > 20) continue;
    out.push(Math.round(mult * 100) / 100);
  }
  return out;
}

/**
 * Convert the live setup into reusable conditions. If we cannot, refuse backtest.
 */
export function buildGeneralizableStrategySpec(
  input: StrategySpecBuildInput,
): StrategySpecBuildResult {
  const symbol = (input.symbol ?? "").toUpperCase();
  const timeframe = (input.timeframe ?? "").trim();
  if (!/^[A-Z]{6}$/.test(symbol) || !timeframe) {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail: "Missing symbol or timeframe for a reusable strategy specification.",
    };
  }

  const regime = (input.marketRegime ?? "").trim() || null;
  const structure = (input.structureBias ?? "").trim() || null;
  const zone = input.zoneType && input.zoneType !== "none" ? input.zoneType : null;
  const confirmation = (input.confirmationRule ?? "").trim() || null;

  // Require at least structure OR zone OR confirmation — not bare prices.
  if (!regime && !structure && !zone && !confirmation) {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail:
        "Setup lacks reusable market structure, zone, regime, or confirmation conditions.",
    };
  }

  const atr = input.atr ?? null;
  const entry = input.entry ?? null;
  const stop = input.stopLoss ?? null;
  const targets = Array.isArray(input.targets) ? input.targets : [];

  let stopLogic: Record<string, unknown> | null = null;
  let targetLogic: Record<string, unknown> | null = null;

  if (atr && entry && stop) {
    const stopMult = relStopAtr(entry, stop, atr);
    if (stopMult != null) {
      stopLogic = {
        type: "atr_multiple",
        atr_multiple: stopMult,
        side: input.direction === "buy" ? "below_entry" : "above_entry",
      };
    }
  }

  if (atr && entry && targets.length) {
    const tMults = relTargetsAtr(entry, targets, atr, input.direction);
    if (tMults.length) {
      targetLogic = {
        type: "atr_multiples",
        atr_multiples: tMults,
        minimum_reward_risk: tMults[0]! / Math.max(0.01, (stopLogic?.atr_multiple as number) ?? 1),
      };
    }
  }

  // Relative risk logic is required for a meaningful historical test.
  if (!stopLogic || !targetLogic) {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail:
        "Could not derive relative stop/target logic from ATR — refusing numeric-only backtest.",
    };
  }

  const invalidation: Record<string, unknown> = {
    type: "structure_break",
    description:
      input.invalidationLevel != null && entry != null && atr != null && atr > 0
        ? `invalidate_if_price_moves_${(
            Math.abs(entry - input.invalidationLevel) / atr
          ).toFixed(2)}_atr_against_thesis`
        : "invalidate_on_opposing_structure_break",
  };

  const strategySpec: ResearchJsonObject = {
    strategy_id: `deep:${symbol}:${timeframe}:${input.direction}`,
    spec_version: "aichart-generalizable-v1",
    market: "forex",
    symbol,
    timeframe,
    direction: input.direction,
    conditions: {
      market_regime: regime,
      structure: structure,
      zone_type: zone,
      confirmation_rules: confirmation ? [confirmation] : [],
      session: input.session ?? null,
      volatility: { reference: "atr", stop: stopLogic, targets: targetLogic },
    },
    risk: {
      stop_loss: stopLogic,
      targets: targetLogic,
      invalidation,
    },
    // Explicitly exclude absolute price levels from the executable spec.
    notes:
      "Generalized from live setup; absolute entry/SL/TP numbers are not backtested as fixed prices.",
  };

  const fingerprint = [
    symbol,
    timeframe,
    input.direction,
    regime ?? "-",
    structure ?? "-",
    zone ?? "-",
    confirmation ?? "-",
    String(stopLogic.atr_multiple),
    (targetLogic.atr_multiples as number[]).join(","),
  ].join("|");

  return { ok: true, strategySpec, fingerprint };
}
