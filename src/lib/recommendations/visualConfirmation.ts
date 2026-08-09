/**
 * Visual-confirmation audit fields for recommendations.
 *
 * Multi-timeframe chart images are a confirmation layer stacked ON TOP of the
 * statistical gates (validated backtest, calibrated confidence, minimum trade
 * count) — never a substitute for them. Consequently this module can only ever
 * *lower* a displayed confidence: agreement between picture and numbers earns
 * no bonus, disagreement costs a fixed, configurable percentage.
 */

import { canonicalizeInterval } from "@/lib/intervals";

export type VisualConfirmation = "confirmed" | "contradicted" | "not_checked";

/** Relative reduction applied to displayed confidence on disagreement. */
export const DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT = 15;
const MAX_PENALTY_PCT = 100;
const MAX_TIMEFRAMES_REVIEWED = 8;

/** Penalty percentage — `VISUAL_CONTRADICTION_PENALTY_PCT` overrides the default. */
export function visualContradictionPenaltyPct(): number {
  const raw = Number(process.env.VISUAL_CONTRADICTION_PENALTY_PCT);
  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_VISUAL_CONTRADICTION_PENALTY_PCT;
  }
  return Math.min(raw, MAX_PENALTY_PCT);
}

/**
 * Accepts the enum or the boolean shorthand.
 *
 * `true` → confirmed, `false` → contradicted. A caller that simply did not look
 * at charts must OMIT the field; the missing/unknown case is `not_checked`, so
 * the boolean shorthand can only ever err toward the conservative side.
 */
export function normalizeVisualConfirmation(raw: unknown): VisualConfirmation {
  if (raw === true) return "confirmed";
  if (raw === false) return "contradicted";
  if (typeof raw === "string") {
    const value = raw.trim().toLowerCase();
    if (value === "confirmed" || value === "contradicted" || value === "not_checked") {
      return value;
    }
  }
  return "not_checked";
}

/** Canonicalises reviewed timeframes for a comparable audit trail. */
export function normalizeTimeframesReviewed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const label = String(item ?? "").trim();
    if (!label) continue;
    // Unknown labels are kept verbatim: the audit records what was claimed.
    const canonical = canonicalizeInterval(label) ?? label.slice(0, 16);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= MAX_TIMEFRAMES_REVIEWED) break;
  }
  return out;
}

export interface VisualConfidenceAdjustment {
  /** Confidence to display, after any contradiction penalty. */
  confidence: number;
  /** Confidence before the penalty — kept for the audit trail. */
  baseConfidence: number;
  penaltyPct: number;
  applied: boolean;
}

/**
 * Applies the contradiction penalty to a DISPLAYED confidence only.
 *
 * The caller must keep server-owned statistical evidence
 * (`backtested_confidence`, its interval, the backtest id) untouched: this
 * adjustment communicates uncertainty to the operator, it does not restate the
 * measured edge.
 */
export function applyVisualConfidencePenalty(
  confidence: number,
  state: VisualConfirmation,
  penaltyPct = visualContradictionPenaltyPct(),
): VisualConfidenceAdjustment {
  const base = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, confidence))
    : 0;
  if (state !== "contradicted" || penaltyPct <= 0) {
    return { confidence: base, baseConfidence: base, penaltyPct, applied: false };
  }
  const reduced = base * (1 - Math.min(penaltyPct, MAX_PENALTY_PCT) / 100);
  return {
    confidence: Math.round(Math.max(0, reduced) * 100) / 100,
    baseConfidence: base,
    penaltyPct,
    applied: true,
  };
}

export interface VisualConfirmationAudit {
  visual_confirmation: VisualConfirmation;
  timeframes_reviewed: string[];
  confidence_penalty_pct: number;
  confidence_before_penalty: number | null;
}

/** The block persisted in `recommendations.context_json` for later review. */
export function buildVisualConfirmationAudit(
  state: VisualConfirmation,
  timeframesReviewed: string[],
  adjustment: VisualConfidenceAdjustment,
): VisualConfirmationAudit {
  return {
    visual_confirmation: state,
    timeframes_reviewed: timeframesReviewed,
    confidence_penalty_pct: adjustment.applied ? adjustment.penaltyPct : 0,
    confidence_before_penalty: adjustment.applied
      ? adjustment.baseConfidence
      : null,
  };
}
