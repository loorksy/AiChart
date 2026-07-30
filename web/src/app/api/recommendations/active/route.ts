import { NextRequest, NextResponse } from "next/server";
import { requirePaidAccess, handleError } from "@/lib/api";
import { query } from "@/lib/db";
import { listActiveTrackedRecommendations } from "@/lib/recommendations/recommendationStore";
import { getCanonicalRecommendationByReference } from "@/lib/recommendations/canonical/repository";
import {
  getEffectiveRevision,
  type RecommendationRevision,
} from "@/lib/recommendations/canonical/revisions";
import { listTriggers } from "@/lib/recommendations/reevaluationTriggers";
import {
  toPublicEvidenceProjection,
  toPublicTrackedRecommendation,
  type PublicEvidenceProjection,
} from "@/lib/recommendations/publicEvidenceProjection";
import type { TrackedRecommendation } from "@/lib/recommendations/types";

/**
 * The operator's active recommendations, each carrying its full explainable
 * state (Group 9): the three-layer plan from the EFFECTIVE revision (plan type,
 * execution state, entry zone, activation condition, invalidation rule,
 * alternative scenario, validity), the frozen evidence bundle and decision
 * trace that revision was decided on, the last re-evaluation trigger raised
 * against it, and the last automatic-execution skip if any.
 *
 * Read-only aggregation over existing stores — nothing here mutates a plan.
 */

export interface ActiveRecommendationView extends TrackedRecommendation {
  activationCondition: string | null;
  evidence: PublicEvidenceProjection | null;
  decisionTrace: Record<string, unknown> | null;
  revisionReason: string | null;
  revisionSource: string | null;
  lastReevaluation: {
    reason: string;
    detail: string;
    source: string;
    outcome: string;
    raisedAt: number;
  } | null;
  lastExecutionSkip: { code: string; occurredAt: number } | null;
}

interface SkipRow {
  dedupe_key: string;
  created_at: number | string;
}

/** Latest execution_skipped dedupe rows, matched per recommendation id. */
async function lastSkipsByRecommendation(
  userId: number,
): Promise<Map<string, { code: string; occurredAt: number }>> {
  const rows = await query<SkipRow>(
    `SELECT dedupe_key, created_at FROM alert_dedupe
      WHERE user_id = ? AND event_type = 'execution_skipped'
      ORDER BY created_at DESC LIMIT 200`,
    [userId],
  ).catch(() => [] as SkipRow[]);

  const byRec = new Map<string, { code: string; occurredAt: number }>();
  for (const row of rows) {
    const marker = ":execution_skipped:";
    const at = row.dedupe_key.indexOf(marker);
    if (at < 0) continue;
    // dedupe_key = `${recId}:${revisionNo}:execution_skipped:${code}`
    const prefix = row.dedupe_key.slice(0, at);
    const recId = prefix.slice(0, prefix.lastIndexOf(":"));
    if (!recId || byRec.has(recId)) continue; // rows are newest-first
    byRec.set(recId, {
      code: row.dedupe_key.slice(at + marker.length),
      occurredAt: Number(row.created_at) || 0,
    });
  }
  return byRec;
}

function overlayRevision(
  rec: TrackedRecommendation,
  revision: RecommendationRevision | null,
): Partial<TrackedRecommendation> & {
  activationCondition: string | null;
  evidence: PublicEvidenceProjection | null;
  decisionTrace: Record<string, unknown> | null;
  revisionReason: string | null;
  revisionSource: string | null;
} {
  if (!revision) {
    return {
      activationCondition: rec.triggerCondition ?? null,
      evidence: null,
      decisionTrace: null,
      revisionReason: null,
      revisionSource: null,
    };
  }
  return {
    planType: (revision.planType ?? rec.planType) as TrackedRecommendation["planType"],
    executionState: (revision.executionState ??
      rec.executionState) as TrackedRecommendation["executionState"],
    revisionNo: revision.revisionNo,
    entry: revision.entry ?? rec.entry,
    stopLoss: revision.stopLoss ?? rec.stopLoss,
    targets: revision.targets.length ? revision.targets : rec.targets,
    entryLow: revision.entryLow ?? rec.entryLow,
    entryHigh: revision.entryHigh ?? rec.entryHigh,
    invalidationRule: revision.invalidationRule ?? rec.invalidationRule,
    alternativeScenario: revision.alternativeScenario ?? rec.alternativeScenario,
    validityCandles: revision.validityCandles ?? rec.validityCandles,
    expiresAt: revision.expiresAt ?? rec.expiresAt,
    activationCondition: revision.activationCondition ?? rec.triggerCondition ?? null,
    // The PUBLIC projection, never the internal snapshot: the card the UI
    // renders plus the identity of the frozen bundle behind it. The snapshot
    // itself carries megabytes of chart base64 and stays server-side.
    evidence: toPublicEvidenceProjection({
      descriptor: revision.evidence,
      fingerprint: revision.evidenceHash,
      revisionNo: revision.revisionNo,
      capturedAt: revision.createdAt,
      sourceSurface: revision.source,
      snapshotStored: Boolean(revision.evidenceHash),
    }),
    decisionTrace: Object.keys(revision.decisionTrace).length ? revision.decisionTrace : null,
    revisionReason: revision.reason || null,
    revisionSource: revision.source || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requirePaidAccess();
    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 30;

    const [recs, skips] = await Promise.all([
      listActiveTrackedRecommendations({ userId: user.id, limit }),
      lastSkipsByRecommendation(user.id),
    ]);

    const recommendations: ActiveRecommendationView[] = await Promise.all(
      recs.map(async (rec) => {
        const canonical = await getCanonicalRecommendationByReference(user.id, rec.id).catch(
          () => null,
        );
        const revision = canonical
          ? await getEffectiveRevision(user.id, canonical.recommendationId).catch(() => null)
          : null;
        const triggers = await listTriggers(rec.id).catch(() => []);
        const latestTrigger = triggers[0] ?? null;
        return {
          ...toPublicTrackedRecommendation(rec),
          ...overlayRevision(rec, revision),
          lastReevaluation: latestTrigger
            ? {
                reason: latestTrigger.reason,
                detail: latestTrigger.detail,
                source: latestTrigger.source,
                outcome: latestTrigger.outcome,
                raisedAt: latestTrigger.raisedAt,
              }
            : null,
          lastExecutionSkip: skips.get(rec.id) ?? null,
        };
      }),
    );

    return NextResponse.json({ recommendations });
  } catch (err) {
    return handleError(err);
  }
}
