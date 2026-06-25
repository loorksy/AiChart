/**
 * Gold Agent X — adaptive advisor weights (0.3–2.0).
 */
import type { AdvisorVote, MemoryStats } from "./types";
import { ADVISOR_NAMES } from "./types";

const MIN_W = 0.3;
const MAX_W = 2.0;

export function defaultAdaptiveWeights(): Record<string, number> {
  const w: Record<string, number> = {};
  for (const name of ADVISOR_NAMES) w[name] = 1;
  return w;
}

export function applyAdaptiveWeights(
  votes: AdvisorVote[],
  weights: Record<string, number>,
): AdvisorVote[] {
  return votes.map((v) => {
    const w = weights[v.advisor] ?? 1;
    return {
      ...v,
      confidence: Math.round(Math.min(100, v.confidence * Math.sqrt(w))),
    };
  });
}

export function updateWeightsFromMemory(
  weights: Record<string, number>,
  memory?: MemoryStats,
): Record<string, number> {
  const next = { ...defaultAdaptiveWeights(), ...weights };
  if (!memory?.advisorAccuracy) return next;

  for (const [advisor, stats] of Object.entries(memory.advisorAccuracy)) {
    if (stats.total < 5) continue;
    const accuracy = stats.correct / stats.total;
    if (accuracy > 0.6) next[advisor] = Math.min(MAX_W, (next[advisor] ?? 1) * 1.05);
    else if (accuracy < 0.4) next[advisor] = Math.max(MIN_W, (next[advisor] ?? 1) * 0.95);
  }

  for (const k of Object.keys(next)) {
    next[k] = Math.max(MIN_W, Math.min(MAX_W, next[k]!));
  }
  return next;
}

export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    out[k] = Math.max(MIN_W, Math.min(MAX_W, (v / sum) * ADVISOR_NAMES.length));
  }
  return out;
}
