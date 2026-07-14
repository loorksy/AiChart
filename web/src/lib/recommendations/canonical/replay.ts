import { getCanonicalRecommendation, listRecommendationHistory, listRecommendationTransitions } from "./repository";
import { listRecommendationLearningEvents, listRecommendationOutcomes } from "./outcomes";
import { RecommendationLifecycleError } from "./types";

export type RecommendationReplayEvent =
  | { kind: "history"; occurredAt: number; sequence: number; data: Awaited<ReturnType<typeof listRecommendationHistory>>[number] }
  | { kind: "transition"; occurredAt: number; sequence: number; data: Awaited<ReturnType<typeof listRecommendationTransitions>>[number] }
  | { kind: "outcome"; occurredAt: number; sequence: number; data: Awaited<ReturnType<typeof listRecommendationOutcomes>>[number] }
  | { kind: "learning"; occurredAt: number; sequence: number; data: Awaited<ReturnType<typeof listRecommendationLearningEvents>>[number] };

export async function replayRecommendation(userId: number, recommendationId: number) {
  const recommendation = await getCanonicalRecommendation(userId, recommendationId);
  if (!recommendation) {
    throw new RecommendationLifecycleError(
      "RECOMMENDATION_NOT_FOUND",
      "Recommendation does not exist for this tenant",
    );
  }
  const [history, transitions, outcomes, learning] = await Promise.all([
    listRecommendationHistory(userId, recommendationId),
    listRecommendationTransitions(userId, recommendationId),
    listRecommendationOutcomes(userId, recommendationId),
    listRecommendationLearningEvents(userId, recommendationId),
  ]);
  const timeline: RecommendationReplayEvent[] = [
    ...history.map((data) => ({ kind: "history" as const, occurredAt: data.occurredAt, sequence: data.id, data })),
    ...transitions.map((data) => ({ kind: "transition" as const, occurredAt: data.occurredAt, sequence: data.id, data })),
    ...outcomes.map((data) => ({ kind: "outcome" as const, occurredAt: data.occurredAt, sequence: data.id, data })),
    ...learning.map((data, index) => ({ kind: "learning" as const, occurredAt: data.occurredAt, sequence: index, data })),
  ].sort((a, b) => a.occurredAt - b.occurredAt || a.kind.localeCompare(b.kind) || a.sequence - b.sequence);

  const reconstructed: Record<string, unknown> = {};
  for (const entry of timeline) {
    if (entry.kind === "history") Object.assign(reconstructed, entry.data.payload);
    if (entry.kind === "transition") {
      reconstructed.status = entry.data.toStatus;
      reconstructed.statusReason = entry.data.reason;
    }
  }
  return { recommendation, reconstructed, timeline };
}
