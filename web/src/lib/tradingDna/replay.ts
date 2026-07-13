import { replayRecommendation } from "@/lib/recommendations/canonical";
import {
  getPersonaForSnapshot,
  getShadowRecommendation,
  getTradingDnaSnapshot,
} from "./repository";

export async function replayShadowRecommendation(userId: number, shadowRecommendationId: string) {
  const shadow = await getShadowRecommendation(userId, shadowRecommendationId);
  if (!shadow) throw new Error("Shadow recommendation does not exist for this tenant");
  const [snapshot, persona, canonical] = await Promise.all([
    getTradingDnaSnapshot(userId, shadow.snapshotId),
    getPersonaForSnapshot(userId, shadow.snapshotId),
    shadow.sourceRecommendationId
      ? replayRecommendation(userId, shadow.sourceRecommendationId)
      : Promise.resolve(null),
  ]);
  if (!snapshot || !persona) throw new Error("Shadow recommendation evidence snapshot is unavailable");
  const timeline = [
    {
      kind: "dna_snapshot" as const,
      occurredAt: snapshot.generatedAt,
      sequence: snapshot.version,
      data: snapshot,
    },
    ...(canonical?.timeline.map((event) => ({
      kind: `canonical_${event.kind}` as const,
      occurredAt: event.occurredAt,
      sequence: event.sequence,
      data: event.data,
    })) ?? []),
    {
      kind: "shadow_created" as const,
      occurredAt: shadow.createdAt,
      sequence: 0,
      data: shadow,
    },
  ].sort((a, b) => a.occurredAt - b.occurredAt || a.kind.localeCompare(b.kind) || a.sequence - b.sequence);
  return { shadow, snapshot, persona, canonicalRecommendation: canonical?.recommendation, timeline };
}
