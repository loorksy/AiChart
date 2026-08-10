/**
 * Per-symbol profile for the fixed 20-instrument universe
 * (markets/forexInstruments.ts). One shared analysis engine, no forking:
 * every symbol runs through the same orchestrator/bias-engine/strategy-catalog
 * code, parameterized by this data map instead of by 20 copies of that code.
 *
 * Follows the canonicalize → exact-symbol lookup → class fallback shape
 * already used by strategies/liveCostProfile.ts and markets/tradingCalendar.ts,
 * so broker-suffixed spellings (XAUUSDm, BTCUSD.pro) resolve to the same
 * profile as the canonical symbol.
 */
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { getStrategyDeployment, type StrategyDeployment } from "@/lib/strategies/evidence";
import { catalogEntriesForTimeframe, type CatalogEntry } from "@/lib/strategies/catalogGen";
import type { ResearchTimeframe } from "@/lib/research";

export type InstrumentClass = "fx_major" | "fx_minor" | "metal" | "crypto";

export interface BiasEngineParams {
  /** How many recent bars biasFromCandles looks back over. */
  lookbackBars: number;
  /** Minimum |close-over-lookback| % change to call a direction (not "neutral"). */
  changeThreshold: number;
}

export interface SymbolProfile {
  symbol: string;
  instrumentClass: InstrumentClass;
  bias: BiasEngineParams;
  /**
   * Strategy-catalog family tags (strategies/catalogGen.ts CatalogEntry.family)
   * this symbol's instrument class is eligible for, on top of the existing
   * timeframe filter (catalogEntriesForTimeframe). Not a live orchestrator
   * gate — matches the catalog's own advisory role ("the catalog proposes,
   * the gates decide") — see strategyFamiliesForSymbol().
   */
  strategyFamilies: string[];
}

const FX_MAJOR_BIAS: BiasEngineParams = { lookbackBars: 50, changeThreshold: 0.003 };
/** Crosses/minors run modestly hotter than majors — a touch wider so noise doesn't flip the read. */
const FX_MINOR_BIAS: BiasEngineParams = { lookbackBars: 50, changeThreshold: 0.0035 };
/**
 * Gold's typical daily % range runs well above a forex major's — 0.003 would
 * flip direction on ordinary noise. This is a documented starting point, not
 * an ATR-calibrated constant; revisit with real live_win_rate evidence once
 * strategy_deployments has enough XAUUSD samples to say more.
 */
const METAL_BIAS: BiasEngineParams = { lookbackBars: 50, changeThreshold: 0.006 };
/** Crypto's % swings dwarf forex/metal — same caveat as METAL_BIAS. */
const CRYPTO_BIAS: BiasEngineParams = { lookbackBars: 50, changeThreshold: 0.015 };

const ALL_FAMILIES = [
  "ema_cross",
  "ema_cross_rsi",
  "rsi_mr",
  "rsi_mr_trend",
  "breakout",
  "atr_regime",
  "session_range",
  "scalp_burst",
  "scalp_micro_break",
  "scalp_quick_mr",
  "scalp_stretch_revert",
] as const;

/** Session-range strategies lean on forex trading-session structure — not meaningful for a 24/7 market. */
const FAMILIES_EX_SESSION = ALL_FAMILIES.filter((f) => f !== "session_range");

const SYMBOL_PROFILES: Record<string, SymbolProfile> = {
  EURUSD: { symbol: "EURUSD", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  GBPUSD: { symbol: "GBPUSD", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  USDJPY: { symbol: "USDJPY", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  USDCHF: { symbol: "USDCHF", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  AUDUSD: { symbol: "AUDUSD", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  USDCAD: { symbol: "USDCAD", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  NZDUSD: { symbol: "NZDUSD", instrumentClass: "fx_major", bias: FX_MAJOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  EURJPY: { symbol: "EURJPY", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  GBPJPY: { symbol: "GBPJPY", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  EURGBP: { symbol: "EURGBP", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  AUDJPY: { symbol: "AUDJPY", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  EURAUD: { symbol: "EURAUD", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  GBPAUD: { symbol: "GBPAUD", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  EURCHF: { symbol: "EURCHF", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  CADJPY: { symbol: "CADJPY", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  NZDJPY: { symbol: "NZDJPY", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  AUDCHF: { symbol: "AUDCHF", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  GBPNZD: { symbol: "GBPNZD", instrumentClass: "fx_minor", bias: FX_MINOR_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  XAUUSD: { symbol: "XAUUSD", instrumentClass: "metal", bias: METAL_BIAS, strategyFamilies: [...ALL_FAMILIES] },
  // Crypto trades 24/7 — forex trading-session structure doesn't apply.
  BTCUSD: { symbol: "BTCUSD", instrumentClass: "crypto", bias: CRYPTO_BIAS, strategyFamilies: [...FAMILIES_EX_SESSION] },
};

const DEFAULT_PROFILE_BIAS = FX_MAJOR_BIAS;

/**
 * Resolve a symbol's profile — canonicalize, then exact-symbol lookup. There
 * is no class-fallback beyond that: the universe is the fixed 20 (see
 * markets/forexInstruments.ts), so a symbol outside it is a caller bug
 * upstream of this lookup (fetchOhlc's own allowlist check catches that
 * earlier), not something this function should guess a profile for.
 */
export function getSymbolProfile(symbol: string): SymbolProfile | null {
  const canonical = forexCanonicalKey(symbol);
  return SYMBOL_PROFILES[canonical] ?? null;
}

/** Bias-engine parameters for a symbol, falling back to the forex-major defaults if unprofiled. */
export function biasParamsForSymbol(symbol: string): BiasEngineParams {
  return getSymbolProfile(symbol)?.bias ?? DEFAULT_PROFILE_BIAS;
}

/**
 * Strategy-catalog families eligible for this symbol — an additional,
 * advisory filter layered on top of catalogEntriesForTimeframe's existing
 * timeframe filter, not a replacement for it and not a live-analysis gate.
 */
export function strategyFamiliesForSymbol(symbol: string): readonly string[] {
  return getSymbolProfile(symbol)?.strategyFamilies ?? ALL_FAMILIES;
}

/**
 * catalogEntriesForTimeframe (strategies/catalogGen.ts), narrowed to the
 * families this symbol's instrument class is eligible for. Composed here
 * rather than in strategies/catalogGen.ts to keep the dependency direction
 * one-way (agent/ → strategies/, never the reverse).
 */
export function catalogEntriesForSymbolAndTimeframe(
  symbol: string,
  timeframe: ResearchTimeframe,
): CatalogEntry[] {
  const families = new Set(strategyFamiliesForSymbol(symbol));
  return catalogEntriesForTimeframe(timeframe).filter((entry) => families.has(entry.family));
}

/**
 * The per-symbol calibrated-confidence source: strategy_deployments, already
 * keyed by (user, strategy, symbol, timeframe) — see strategies/evidence.ts.
 * No new confidence store is introduced; this is a thin, symbol-profile-aware
 * pointer to the existing one. PERFORMANCE_JOURNAL_V1 (recommendations/
 * performanceJournal.ts) is a separate, global/aggregate operator journal —
 * it does not back per-symbol confidence and is not used here.
 */
export async function calibratedConfidenceForSymbol(
  userId: number,
  symbol: string,
  strategyId: string,
  timeframe: string,
): Promise<StrategyDeployment | null> {
  return getStrategyDeployment(userId, strategyId, symbol, timeframe);
}

/** The fixed universe this module covers — must match markets/forexInstruments.ts exactly. */
export function profiledSymbols(): readonly string[] {
  return Object.keys(SYMBOL_PROFILES);
}
