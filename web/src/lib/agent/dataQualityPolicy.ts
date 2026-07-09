/**
 * Central candle-coverage policy. Analysis, trade recommendation, and drawing
 * each have their own gate so the thresholds never drift apart between files.
 *
 * - Analysis may proceed below threshold WITH warnings.
 * - A trade recommendation requires the trade threshold (else WAIT).
 * - Drawings require the drawing threshold (else no drawings).
 * Insufficient coverage triggers backfill upstream but never invents data.
 */

export interface DataQualityThresholds {
  currentTf: number;
  higherTf: number;
  daily: number;
}

export const DATA_QUALITY_POLICY: {
  analysis: DataQualityThresholds;
  trade: DataQualityThresholds;
  drawing: DataQualityThresholds;
} = {
  analysis: { currentTf: 300, higherTf: 100, daily: 50 },
  trade: { currentTf: 500, higherTf: 200, daily: 100 },
  drawing: { currentTf: 500, higherTf: 200, daily: 100 },
};

export interface CandleCounts {
  currentTfCount: number;
  higherTfCount: number;
  dailyCount: number;
}

export function meetsDataQuality(
  counts: CandleCounts,
  gate: keyof typeof DATA_QUALITY_POLICY,
): boolean {
  const t = DATA_QUALITY_POLICY[gate];
  return (
    counts.currentTfCount >= t.currentTf &&
    counts.higherTfCount >= t.higherTf &&
    counts.dailyCount >= t.daily
  );
}
