/**
 * Build a reusable, generalizable Strategy Specification for Deep Analysis.
 * Never construct a backtest from current numeric entry/SL/TP alone.
 * Output must satisfy Research Service StrategySpecification (spec_version 1.0.0).
 */
import type { ResearchJsonObject, ResearchTimeframe } from "@/lib/research/types";
import {
  BACKTEST_STRATEGY_IDS,
  buildBacktestStrategySpec,
  isBacktestStrategyId,
  type BacktestStrategyId,
  type StrategyCostProfile,
} from "@/lib/strategies/catalog";

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
  /** Optional broker cost profile; defaults keep research deterministic. */
  costs?: StrategyCostProfile | null;
  /** Optional catalog override when caller already chose a validated strategy. */
  strategyId?: string | null;
}

export type StrategySpecBuildResult =
  | {
      ok: true;
      strategySpec: ResearchJsonObject;
      fingerprint: string;
      strategyId: BacktestStrategyId;
    }
  | {
      ok: false;
      reason: "setup_not_generalizable";
      detail: string;
    };

const RESEARCH_TF = new Set<string>([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);

const DEFAULT_COSTS: StrategyCostProfile = {
  spreadPips: 1.5,
  slippagePips: 0.5,
  commissionPerLotSideUsd: 0,
};

function asResearchTf(interval: string): ResearchTimeframe | null {
  const n = interval.trim().toLowerCase();
  return RESEARCH_TF.has(n) ? (n as ResearchTimeframe) : null;
}

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
 * Map qualitative live context onto one of the catalog strategies that the
 * Research Service can actually execute.
 */
export function selectCatalogStrategyId(input: {
  marketRegime?: string | null;
  structureBias?: string | null;
  zoneType?: "demand" | "supply" | "none" | null;
  confirmationRule?: string | null;
  strategyId?: string | null;
}): BacktestStrategyId {
  if (input.strategyId && isBacktestStrategyId(input.strategyId)) {
    return input.strategyId;
  }
  const haystack = [
    input.marketRegime,
    input.structureBias,
    input.zoneType,
    input.confirmationRule,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();

  if (
    /breakout|range_break|break\b/.test(haystack) ||
    haystack.includes("consolidation")
  ) {
    return "range_breakout_v1";
  }
  if (
    /mean.?reversion|oversold|overbought|rsi|range|ranging|sideways/.test(
      haystack,
    ) ||
    input.zoneType === "demand" ||
    input.zoneType === "supply"
  ) {
    return "rsi_mean_reversion_v1";
  }
  if (/trend|momentum|continuation|ema/.test(haystack)) {
    return "ema_trend_follow_v1";
  }
  return BACKTEST_STRATEGY_IDS[0];
}

/**
 * Convert the live setup into a Research-valid catalog strategy specification.
 * If we cannot derive relative risk logic, refuse backtest.
 */
export function buildGeneralizableStrategySpec(
  input: StrategySpecBuildInput,
): StrategySpecBuildResult {
  const symbol = (input.symbol ?? "").toUpperCase();
  const timeframe = asResearchTf(input.timeframe ?? "");
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

  let stopMult: number | null = null;
  let targetMults: number[] = [];

  if (atr && entry && stop) {
    stopMult = relStopAtr(entry, stop, atr);
  }
  if (atr && entry && targets.length) {
    targetMults = relTargetsAtr(entry, targets, atr, input.direction);
  }

  // Relative risk logic is required for a meaningful historical test.
  if (stopMult == null || targetMults.length === 0) {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail:
        "Could not derive relative stop/target logic from ATR — refusing numeric-only backtest.",
    };
  }

  const strategyId = selectCatalogStrategyId(input);
  const base = buildBacktestStrategySpec({
    strategyId,
    symbol,
    timeframe,
    costs: input.costs ?? DEFAULT_COSTS,
  });

  const sizeEach = Math.round((100 / targetMults.length) * 100) / 100;
  const targetsSpec = targetMults.map((value, index) => ({
    type: "atr_multiple" as const,
    size_percent:
      index === targetMults.length - 1
        ? Math.round((100 - sizeEach * (targetMults.length - 1)) * 100) / 100
        : sizeEach,
    value,
    period: 14,
    timeframe,
  }));

  const longTree = base.long_entry_conditions;
  const shortTree = base.short_entry_conditions;
  const entryTree =
    input.direction === "buy"
      ? (longTree as ResearchJsonObject | undefined)
      : (shortTree as ResearchJsonObject | undefined);
  if (!entryTree || typeof entryTree !== "object") {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail: "Catalog strategy is missing an entry condition tree for this direction.",
    };
  }

  const {
    long_entry_conditions: _long,
    short_entry_conditions: _short,
    ...baseRest
  } = base;

  const strategySpec: ResearchJsonObject = {
    ...baseRest,
    strategy_id: strategyId,
    version_id: `${strategyId}.deep.1`,
    name: `${String(base.name)} (deep ${input.direction})`,
    description: [
      "Deep Analysis mapping of a live setup onto a catalog strategy with ATR-relative risk; research-only evidence, never execution authority.",
      `regime=${regime ?? "-"}`,
      `structure=${structure ?? "-"}`,
      `zone=${zone ?? "-"}`,
      `confirmation=${confirmation ?? "-"}`,
      `session=${input.session ?? "-"}`,
    ].join(" "),
    // Research Service requires entry_conditions for long/short (not side trees).
    direction: input.direction === "buy" ? "long" : "short",
    entry_conditions: entryTree,
    stop_loss: {
      type: "atr_multiple",
      value: stopMult,
      period: 14,
      timeframe,
    },
    targets: targetsSpec,
  };

  const fingerprint = [
    strategyId,
    symbol,
    timeframe,
    input.direction,
    regime ?? "-",
    structure ?? "-",
    zone ?? "-",
    confirmation ?? "-",
    String(stopMult),
    targetMults.join(","),
  ].join("|");

  return { ok: true, strategySpec, fingerprint, strategyId };
}
