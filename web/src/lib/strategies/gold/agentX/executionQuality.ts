/**
 * Gold Agent X — execution quality tracking.
 */
import { clampScore } from "./types";

const MAX_SAMPLES = 20;

export function recordExecutionQuality(
  scores: number[] | undefined,
  expectedPrice: number,
  fillPrice: number,
  latencyMs?: number,
): number[] {
  const slippagePips = Math.abs(fillPrice - expectedPrice) * 100;
  let score = 100;
  if (slippagePips > 5) score -= 20;
  if (slippagePips > 15) score -= 30;
  if (slippagePips > 30) score -= 30;
  if (latencyMs != null && latencyMs > 2000) score -= 15;
  score = clampScore(score);

  const next = [...(scores ?? []), score].slice(-MAX_SAMPLES);
  return next;
}

export function averageExecutionQuality(scores?: number[]): number {
  if (!scores?.length) return 75;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
