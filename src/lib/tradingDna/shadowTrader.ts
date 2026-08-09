import { mergeEvidence, normalizeEvidence, requireEvidence } from "./evidence";
import { buildTradingDnaDraft } from "./service";
import { persistShadowRecommendation, persistTradingDnaSnapshot } from "./repository";
import type {
  BacktestEvidenceReference,
  ShadowDirection,
  TradingDnaEvidenceBundle,
} from "./types";

const ELIGIBLE_BASELINE_STATUSES = new Set(["draft", "active", "triggered", "partially_closed"]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function matchingRecommendations(
  bundle: TradingDnaEvidenceBundle,
  symbol: string,
  timeframe: string,
) {
  return bundle.recommendations.filter(
    (item) => item.symbol === symbol && (timeframe === "any" || item.timeframe === timeframe),
  );
}

function observedResults(bundle: TradingDnaEvidenceBundle): Map<number, "win" | "loss"> {
  const results = new Map<number, "win" | "loss">();
  for (const event of bundle.learningEvents) {
    if (event.eventType === "RecommendationSucceeded") results.set(event.recommendationId, "win");
    if (event.eventType === "RecommendationFailed") results.set(event.recommendationId, "loss");
  }
  return results;
}

function historicalDirection(
  bundle: TradingDnaEvidenceBundle,
  candidates: ReturnType<typeof matchingRecommendations>,
): { direction: ShadowDirection; confidence: number } {
  const results = observedResults(bundle);
  const scores = { buy: 0, sell: 0 };
  let observations = 0;
  for (const item of candidates) {
    if (item.direction === "wait") continue;
    const result = results.get(item.recommendationId);
    if (!result) continue;
    scores[item.direction] += result === "win" ? 1 : -1;
    observations += 1;
  }
  if (observations < 3 || Math.abs(scores.buy - scores.sell) < 2) {
    return { direction: "wait", confidence: observations ? 40 : 0 };
  }
  const direction = scores.buy > scores.sell ? "buy" : "sell";
  return {
    direction,
    confidence: clamp(50 + (Math.abs(scores.buy - scores.sell) / observations) * 30, 0, 80),
  };
}

export async function generateShadowRecommendation(input: {
  userId: number;
  symbol: string;
  timeframe: string;
  fromMs?: number;
  toMs?: number;
  backtests?: BacktestEvidenceReference[];
  now?: number;
}) {
  const symbol = input.symbol.trim().toUpperCase();
  const timeframe = input.timeframe.trim().toLowerCase();
  if (!/^[A-Z0-9._-]{3,20}$/.test(symbol) || !/^[a-z0-9]{1,8}$/.test(timeframe)) {
    throw new Error("Invalid Shadow Trader market context");
  }
  const draft = await buildTradingDnaDraft(input.userId, {
    fromMs: input.fromMs,
    toMs: input.toMs,
    backtests: input.backtests,
    now: input.now,
  });
  requireEvidence(draft.evidence, "Shadow Trader input");
  const persisted = await persistTradingDnaSnapshot({
    userId: input.userId,
    generatedAt: input.now,
    windowStart: input.fromMs,
    windowEnd: input.toMs,
    sampleSize: draft.evidenceBundle.recommendations.length,
    metrics: draft.metrics,
    conclusions: draft.conclusions,
    evidence: draft.evidence,
  });
  const candidates = matchingRecommendations(draft.evidenceBundle, symbol, timeframe);
  const baseline = [...candidates]
    .reverse()
    .find((item) => item.direction !== "wait" && ELIGIBLE_BASELINE_STATUSES.has(item.status));
  const historical = historicalDirection(draft.evidenceBundle, candidates);
  let direction: ShadowDirection = baseline?.direction ?? historical.direction;
  let confidence = baseline ? clamp(baseline.confidence * 0.7 + historical.confidence * 0.3, 0, 95) : historical.confidence;
  const rationale: string[] = [];
  if (baseline) rationale.push(`Canonical recommendation ${baseline.recommendationId} is the research baseline.`);
  if (historical.direction !== "wait") rationale.push(`Historical completed evidence supports ${historical.direction}.`);

  const candidateIds = new Set(candidates.map((item) => item.recommendationId));
  const linkedTrades = draft.evidenceBundle.trades.filter(
    (item) => item.recommendationId != null && candidateIds.has(item.recommendationId),
  );
  const closedTrades = linkedTrades.filter((item) => item.status === "closed");
  if (closedTrades.length >= 3) {
    const profitable = closedTrades.filter((item) => item.pnl > 0).length;
    const tradeWinRate = profitable / closedTrades.length;
    confidence = clamp(confidence + (tradeWinRate - 0.5) * 10, 0, 95);
    rationale.push(`${closedTrades.length} linked closed trades have a ${(tradeWinRate * 100).toFixed(1)}% positive-PnL rate.`);
  }

  const relevantLessons = draft.evidenceBundle.lessons.filter(
    (lesson) => !baseline || lesson.strategyId === baseline.strategyId,
  );
  if (relevantLessons.length) {
    const positive = relevantLessons.filter((lesson) => lesson.fingerprint.endsWith(":success"));
    const negative = relevantLessons.filter((lesson) => lesson.fingerprint.endsWith(":failure"));
    const adjustment = positive.reduce((sum, item) => sum + item.confidence, 0) - negative.reduce((sum, item) => sum + item.confidence, 0);
    confidence = clamp(confidence + clamp(adjustment * 3, -5, 5), 0, 95);
    rationale.push(`${relevantLessons.length} validated Trade Lesson(s) were included.`);
  }
  if (draft.evidenceBundle.backtests.length) {
    rationale.push(`${draft.evidenceBundle.backtests.length} tenant-verified successful Research Service job(s) are referenced without inferring unexposed metrics.`);
  }
  if (!baseline && historical.direction === "wait") {
    direction = "wait";
    rationale.push("No eligible canonical baseline or dominant completed historical direction exists.");
  }

  const shadowEvidence = mergeEvidence(
    normalizeEvidence({
      recommendationIds: candidates.map((item) => item.recommendationId),
      tradeIds: linkedTrades.map((item) => item.tradeId),
      learningEventIds: draft.evidenceBundle.learningEvents
        .filter((item) => candidateIds.has(item.recommendationId))
        .map((item) => item.eventId),
      backtestIds: draft.evidenceBundle.backtests.map((item) => item.jobId),
      artifactIds: draft.evidenceBundle.backtests.flatMap((item) => item.artifactIds),
    }),
    ...relevantLessons.map((lesson) =>
      normalizeEvidence({
        recommendationIds: [lesson.recommendationId],
        learningEventIds: lesson.evidenceEventIds,
      }),
    ),
  );
  requireEvidence(shadowEvidence, "Shadow recommendation");
  return persistShadowRecommendation({
    userId: input.userId,
    snapshotId: persisted.snapshot.snapshotId,
    sourceRecommendationId: baseline?.recommendationId,
    symbol,
    timeframe,
    direction,
    confidence: Math.round(confidence * 100) / 100,
    rationale,
    evidence: shadowEvidence,
    createdAt: input.now ?? Date.now(),
  });
}
