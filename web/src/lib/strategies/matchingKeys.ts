/**
 * Canonical matching keys for the strategy-evidence chain.
 *
 * `strategy_deployments` rows are keyed by the CANONICAL symbol (XAUUSD) and
 * one of the seven research timeframes. Recommendations historically stored
 * whatever the model sent — broker-suffixed symbols (XAUUSDM) and free-form
 * timeframes ("H1", "60", "1D") — so the exact-match deployment lookup and the
 * execution-eligibility JOIN failed even when validated evidence existed.
 *
 * EVERY write and read that participates in evidence matching must go through
 * these two helpers. Display/broker surfaces (MT5 capture, EA commands) keep
 * the raw symbol — only the matching keys are canonicalised.
 */
import { normalizeSymbol } from "@/lib/markets/symbolMapping";
import { canonicalizeInterval } from "@/lib/intervals";
import type { ResearchTimeframe } from "@/lib/research/types";

export const RESEARCH_TIMEFRAMES: readonly ResearchTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

const RESEARCH_TIMEFRAME_SET = new Set<string>(RESEARCH_TIMEFRAMES);

/** MT-style and TV-style aliases that canonicalizeInterval does not cover. */
const TIMEFRAME_ALIASES: Record<string, ResearchTimeframe> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
  D: "1d",
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1h",
  "240": "4h",
  "1440": "1d",
};

/** Broker-suffix-free symbol key (XAUUSDM → XAUUSD). Matches deployments. */
export function canonicalStrategySymbol(raw: string): string {
  return normalizeSymbol(raw).canonical;
}

/**
 * Maps any reasonable timeframe spelling onto the seven research timeframes,
 * or null when it cannot be expressed there (e.g. "1w", "banana").
 */
export function canonicalStrategyTimeframe(raw: string): ResearchTimeframe | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  if (RESEARCH_TIMEFRAME_SET.has(trimmed)) return trimmed as ResearchTimeframe;

  const alias = TIMEFRAME_ALIASES[trimmed.toUpperCase()];
  if (alias) return alias;

  const canonical = canonicalizeInterval(trimmed);
  if (canonical && RESEARCH_TIMEFRAME_SET.has(canonical)) {
    return canonical as ResearchTimeframe;
  }
  return null;
}

/**
 * Best-effort canonicalisation for storage: research timeframe when mappable,
 * otherwise the trimmed original (WAIT recommendations may reference frames
 * the research engine does not model — the audit trail keeps what was said).
 */
export function storageStrategyTimeframe(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  return canonicalStrategyTimeframe(trimmed) ?? trimmed;
}
