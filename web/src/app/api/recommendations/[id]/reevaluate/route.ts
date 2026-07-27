import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  checkRateLimit,
  clientKey,
  handleError,
  requirePaidAccess,
} from "@/lib/api";
import { getCanonicalRecommendationByReference } from "@/lib/recommendations/canonical/repository";
import { getEffectiveRevision } from "@/lib/recommendations/canonical/revisions";
import {
  admitTriggers,
  type ReevaluationTrigger,
} from "@/lib/recommendations/reevaluationTriggers";
import { runReevaluationCycle } from "@/lib/recommendations/reevaluationCycle";

/**
 * Operator-priority re-evaluation. The request is a trigger only: the endpoint
 * cannot supply direction or levels, and the unified brain remains the decider.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requirePaidAccess();
    // Each accepted request runs a full unified-brain cycle. `user_request` is
    // exempt from the trigger cooldown/cap by design, so this is the only thing
    // standing between one paid account and unbounded LLM spend.
    if (!checkRateLimit(`reevaluate:${user.id}:${clientKey(req)}`, 10, 60_000)) {
      throw new ApiError(429, "Too many re-evaluation requests; try again shortly.");
    }
    const { id } = await ctx.params;
    const recommendation = await getCanonicalRecommendationByReference(
      user.id,
      id,
    );
    if (!recommendation) {
      throw new ApiError(404, "Recommendation not found.");
    }
    const effective = await getEffectiveRevision(
      user.id,
      recommendation.recommendationId,
    );
    if (!effective) {
      throw new ApiError(409, "Recommendation has no effective revision.");
    }
    const body = (await req.json().catch(() => ({}))) as {
      reason?: unknown;
    };
    const operatorReason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "The operator requested a fresh decision.";
    const now = Date.now();
    const callerKey = req.headers.get("idempotency-key")?.trim().slice(0, 120);
    const trigger: ReevaluationTrigger = {
      recommendationId:
        recommendation.legacyTrackingId ??
        String(recommendation.recommendationId),
      userId: user.id,
      symbol: recommendation.symbol,
      reason: "user_request",
      detail: operatorReason,
      source: "user",
      revisionNo: effective.revisionNo,
      raisedAt: now,
      idempotencyKey: callerKey
        ? `user:${callerKey}`
        : `user:${recommendation.recommendationId}:${effective.revisionNo}:${Math.floor(now / 5_000)}`,
    };
    const { admitted } = await admitTriggers([trigger]);
    if (!admitted.length) {
      throw new ApiError(409, "Re-evaluation is already being claimed.");
    }
    const result = await runReevaluationCycle(
      admitted[0]!,
      recommendation.recommendationId,
    );
    return NextResponse.json({ result });
  } catch (error) {
    return handleError(error);
  }
}
