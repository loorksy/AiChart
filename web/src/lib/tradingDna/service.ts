import { buildTradingDnaConclusions } from "./conclusions";
import {
  collectTradingDnaEvidence,
  evidenceFromBundle,
  type CollectTradingDnaEvidenceOptions,
} from "./evidence";
import { computeTradingDnaMetrics } from "./metrics";
import { persistTradingDnaSnapshot } from "./repository";

export async function buildTradingDnaDraft(
  userId: number,
  options: CollectTradingDnaEvidenceOptions = {},
) {
  const evidenceBundle = await collectTradingDnaEvidence(userId, options);
  const metrics = computeTradingDnaMetrics(evidenceBundle);
  const conclusions = buildTradingDnaConclusions(metrics);
  return {
    evidenceBundle,
    metrics,
    conclusions,
    evidence: evidenceFromBundle(evidenceBundle),
  };
}

export async function generateTradingDnaSnapshot(
  userId: number,
  options: CollectTradingDnaEvidenceOptions = {},
) {
  const draft = await buildTradingDnaDraft(userId, options);
  return persistTradingDnaSnapshot({
    userId,
    generatedAt: options.now,
    windowStart: options.fromMs,
    windowEnd: options.toMs,
    sampleSize: draft.evidenceBundle.recommendations.length,
    metrics: draft.metrics,
    conclusions: draft.conclusions,
    evidence: draft.evidence,
  });
}
