/**
 * Tradability calibration — did the verdicts tell the truth?
 *
 * The budget (tradability.ts) predicts reachability at creation: a verdict and
 * an optimistic bars-to-activation estimate. This module measures what actually
 * happened — did the plan activate, and in how many candles — grouped by
 * verdict, so the limits in TRADABILITY_LIMITS are tuned against evidence
 * instead of taste (docs/PLATFORM_AGENT_UPGRADE_PLAN.md §1.5).
 *
 * Pure aggregation: rows in, report out. The cron route owns the SQL.
 */
import { intervalMs } from "@/lib/agent/trading/tradePlan";
import { TRADABILITY_VALUES, type Tradability } from "./tradability";

export interface CalibrationRow {
  id: number;
  timeframe: string;
  status: string;
  createdAt: number;
  contextJson: string | null;
  /** Epoch ms of the first transition into `triggered`, when one exists. */
  triggeredAt: number | null;
}

export interface VerdictCalibration {
  verdict: Tradability;
  total: number;
  activated: number;
  /** Reached a terminal state without ever activating. */
  diedWaiting: number;
  /** activated / total, null when the sample is empty. */
  activationRate: number | null;
  /** Mean of the optimistic estimates recorded at creation. */
  avgPredictedBars: number | null;
  /** Mean realized candles-to-activation, activated plans only. */
  avgActualBars: number | null;
}

export interface CalibrationReport {
  sampled: number;
  /** Rows with no parseable verdict — written before the budget existed. */
  ungraded: number;
  verdicts: VerdictCalibration[];
}

const TERMINAL_STATUSES = new Set([
  "tp_hit",
  "sl_hit",
  "expired",
  "cancelled",
  "invalidated",
  "closed",
]);

function verdictOf(contextJson: string | null): {
  verdict: Tradability;
  predictedBars: number | null;
} | null {
  if (!contextJson) return null;
  try {
    const parsed = JSON.parse(contextJson) as {
      tradability?: {
        tradability?: unknown;
        expectedBarsToActivation?: unknown;
      } | null;
    };
    const raw = parsed.tradability;
    const verdict = raw && typeof raw === "object" ? raw.tradability : null;
    if (
      typeof verdict !== "string" ||
      !(TRADABILITY_VALUES as readonly string[]).includes(verdict)
    ) {
      return null;
    }
    const bars = raw!.expectedBarsToActivation;
    return {
      verdict: verdict as Tradability,
      predictedBars:
        typeof bars === "number" && Number.isFinite(bars) ? bars : null,
    };
  } catch {
    return null;
  }
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

/** Aggregate declared verdicts against realized activation. */
export function calibrateTradability(rows: CalibrationRow[]): CalibrationReport {
  let ungraded = 0;
  const buckets = new Map<
    Tradability,
    { total: number; activated: number; diedWaiting: number; predicted: number[]; actual: number[] }
  >();
  for (const value of TRADABILITY_VALUES) {
    buckets.set(value, {
      total: 0,
      activated: 0,
      diedWaiting: 0,
      predicted: [],
      actual: [],
    });
  }

  for (const row of rows) {
    const graded = verdictOf(row.contextJson);
    if (!graded) {
      ungraded += 1;
      continue;
    }
    const bucket = buckets.get(graded.verdict)!;
    bucket.total += 1;
    if (graded.predictedBars != null) bucket.predicted.push(graded.predictedBars);

    if (row.triggeredAt != null && row.triggeredAt >= row.createdAt) {
      bucket.activated += 1;
      const bar = intervalMs(row.timeframe);
      if (bar > 0) {
        bucket.actual.push(
          Math.round(((row.triggeredAt - row.createdAt) / bar) * 100) / 100,
        );
      }
    } else if (TERMINAL_STATUSES.has(row.status)) {
      bucket.diedWaiting += 1;
    }
  }

  return {
    sampled: rows.length,
    ungraded,
    verdicts: TRADABILITY_VALUES.map((verdict) => {
      const b = buckets.get(verdict)!;
      return {
        verdict,
        total: b.total,
        activated: b.activated,
        diedWaiting: b.diedWaiting,
        activationRate:
          b.total > 0 ? Math.round((b.activated / b.total) * 1000) / 1000 : null,
        avgPredictedBars: mean(b.predicted),
        avgActualBars: mean(b.actual),
      };
    }),
  };
}
