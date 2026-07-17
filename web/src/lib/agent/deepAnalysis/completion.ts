/**
 * Deep Analysis completion — append-only lifecycle revisions, never silent overwrite,
 * never trade mutation/execution.
 */
import { createLogger } from "@/lib/logger";
import { appendMessage } from "@/lib/agent/chatHistory/chatStore";
import { refreshChatMetaAfterAssistantTurn } from "@/lib/agent/chatHistory/refreshChatMeta";
import { getResearchJob } from "@/lib/research/client";
import {
  appendRecommendationHistory,
  getCanonicalRecommendation,
} from "@/lib/recommendations/canonical/repository";
import { isTerminalRecommendationStatus } from "@/lib/recommendations/canonical/stateMachine";
import {
  composeDeepAnalysisUpdate,
  mapProgressToUxPhase,
} from "./composeUpdate";
import {
  getDeepAnalysisRun,
  getLatestDeepAnalysisForSessionSymbol,
  listPendingDeepAnalysisRuns,
  updateDeepAnalysisRun,
  type DeepAnalysisInternalProgress,
  type DeepAnalysisRun,
} from "./store";
import {
  toUserSafeResearchProjection,
  type UserSafeResearchProjection,
} from "../userSafeOutbound";
import type { ResearchEvidenceBundle } from "../researchEvidence";

const log = createLogger("deepAnalysis.completion");

async function resolveCanonicalRecommendationId(
  userId: number,
  legacyRef: string | null | undefined,
): Promise<number | null> {
  if (!legacyRef) return null;
  const { getCanonicalRecommendationByReference } = await import(
    "@/lib/recommendations/canonical/repository"
  );
  const rec = await getCanonicalRecommendationByReference(userId, legacyRef);
  return rec?.recommendationId ?? null;
}

function emptyBundle(
  delta: number,
  agreementNote: string,
): ResearchEvidenceBundle {
  return {
    evidenceVersion: "1.1.0",
    contributions: [
      {
        system: "backtest",
        status: delta === 0 ? "skipped" : "used",
        reason:
          delta === 0
            ? "insufficient_historical_metrics"
            : "deep_analysis_completed",
        reasonDetail: agreementNote,
        evidenceTendency: delta,
      },
    ],
    historicalEvidenceTendency: delta,
    summaryAr: "",
    summaryEn: "",
    timeline: [],
    usedSystems: delta === 0 ? [] : ["backtest"],
    skippedSystems:
      delta === 0
        ? [
            {
              system: "backtest",
              reason: "insufficient_historical_metrics",
              reasonDetail: agreementNote,
            },
          ]
        : [],
  };
}

/**
 * Score completed research into a bounded evidence tendency for context only.
 * Presence of a job alone never changes the recommendation or its confidence.
 */
export function scoreCompletedResearchJob(job: {
  status?: string;
  result_summary?: string | null;
  error?: string | null;
}): { delta: number; agreement: string; metricsPresent: boolean } {
  if (job.status !== "succeeded") {
    return {
      delta: 0,
      agreement: "Research job did not succeed.",
      metricsPresent: false,
    };
  }
  const summary = (job.result_summary ?? "").trim();
  if (!summary) {
    return {
      delta: 0,
      agreement: "insufficient_historical_metrics",
      metricsPresent: false,
    };
  }

  // Best-effort parse of common metric tokens from verified summaries only.
  const winRate = summary.match(/win[_\s-]?rate[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  const expectancy = summary.match(
    /expectancy[^0-9\-]*(-?[0-9]+(?:\.[0-9]+)?)/i,
  );
  const maxDd = summary.match(
    /max[_\s-]?drawdown[^0-9]*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const trades = summary.match(/(?:trades|sample|n)[^0-9]*([0-9]{1,5})/i);

  const sample = trades ? Number(trades[1]) : 0;
  if (sample > 0 && sample < 10) {
    return {
      delta: 0,
      agreement: "Sample too small for reliable historical influence.",
      metricsPresent: true,
    };
  }

  let delta = 0;
  let metricsPresent = false;
  if (winRate) {
    metricsPresent = true;
    const wr = Number(winRate[1]);
    if (wr >= 55) delta += 0.04;
    else if (wr < 45) delta -= 0.05;
  }
  if (expectancy) {
    metricsPresent = true;
    const exp = Number(expectancy[1]);
    if (exp > 0) delta += 0.03;
    else if (exp < 0) delta -= 0.04;
  }
  if (maxDd) {
    metricsPresent = true;
    const dd = Number(maxDd[1]);
    if (dd > 25) delta -= 0.05;
    else if (dd > 15) delta -= 0.02;
  }

  if (!metricsPresent) {
    return {
      delta: 0,
      agreement: "insufficient_historical_metrics",
      metricsPresent: false,
    };
  }

  delta = Math.max(-0.12, Math.min(0.08, delta));
  return {
    delta,
    agreement:
      delta > 0
        ? "Historical metrics support the setup."
        : delta < 0
          ? "Historical metrics conflict with or weaken the setup."
          : "Historical metrics were neutral.",
    metricsPresent: true,
  };
}

export async function pollDeepAnalysisOnce(payload: {
  userId: number;
  analysisId: string;
  researchJobId: string;
  sessionId: string;
  recommendationId?: number | null;
  generation: number;
}): Promise<void> {
  const run = await getDeepAnalysisRun(payload.userId, payload.analysisId);
  if (!run) {
    log.info("deep analysis missing; skip", { analysisId: payload.analysisId });
    return;
  }
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "discarded" ||
    run.status === "cancelled"
  ) {
    return;
  }

  // Stale generation — a newer analysis exists for this session/symbol.
  if (run.sessionId) {
    const latest = await getLatestDeepAnalysisForSessionSymbol({
      userId: payload.userId,
      sessionId: run.sessionId,
      symbol: run.symbol,
    });
    if (latest && latest.generation > run.generation) {
      await updateDeepAnalysisRun(payload.userId, payload.analysisId, {
        status: "discarded",
        failureReason: "stale_superseded_by_newer_analysis",
        completedAt: Date.now(),
      });
      return;
    }
  }

  let job;
  try {
    job = await getResearchJob(
      { userId: payload.userId, requestId: payload.analysisId },
      payload.researchJobId,
    );
  } catch (err) {
    log.warn("getResearchJob failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    await scheduleRepoll(payload);
    return;
  }

  const status = String(job.status ?? "").toLowerCase();
  if (status === "queued" || status === "running" || status === "pending") {
    // One meaningful intermediate update when progress is material.
    if (
      run.uxUpdateCount === 1 &&
      typeof job.progress_percent === "number" &&
      job.progress_percent >= 45
    ) {
      await emitUxIfAllowed(run, "almost_ready");
    }
    await updateDeepAnalysisRun(payload.userId, payload.analysisId, {
      status: "running",
      internalProgress: "polling",
    });
    await scheduleRepoll(payload);
    return;
  }

  if (status === "failed" || status === "cancelled" || status === "canceled") {
    await finalizeFailure(run, "research_job_failed");
    return;
  }

  if (status === "succeeded") {
    await finalizeSuccess(run, job);
    return;
  }

  await finalizeFailure(run, `unexpected_job_status:${status}`);
}

async function scheduleRepoll(payload: {
  userId: number;
  analysisId: string;
  researchJobId: string;
  sessionId: string;
  recommendationId?: number | null;
  generation: number;
}): Promise<void> {
  const { enqueue } = await import("@/lib/queue");
  await enqueue(
    "deep_analysis_poll",
    {
      userId: payload.userId,
      analysisId: payload.analysisId,
      researchJobId: payload.researchJobId,
      sessionId: payload.sessionId,
      recommendationId: payload.recommendationId ?? null,
      generation: payload.generation,
    },
    { delayMs: 2_500 },
  );
}

async function emitUxIfAllowed(
  run: DeepAnalysisRun,
  progress: DeepAnalysisInternalProgress,
): Promise<DeepAnalysisRun> {
  const phase = mapProgressToUxPhase(progress, run.uxUpdateCount);
  if (!phase) return run;
  const composed = composeDeepAnalysisUpdate({
    locale: run.locale,
    phase,
  });
  await appendChatUpdate(run, composed.text);
  return (
    (await updateDeepAnalysisRun(run.userId, run.analysisId, {
      internalProgress: progress,
      uxUpdateCount: run.uxUpdateCount + 1,
    })) ?? run
  );
}

async function appendChatUpdate(
  run: DeepAnalysisRun,
  text: string,
): Promise<void> {
  if (!run.chatId) return;
  try {
    await appendMessage(run.userId, run.chatId, {
      role: "assistant",
      content: text,
      analysisId: run.analysisId,
      recommendationId: run.recommendationRef ?? undefined,
      symbol: run.symbol,
      interval: run.interval,
    });
    void refreshChatMetaAfterAssistantTurn(run.userId, run.chatId);
  } catch (err) {
    // Session deleted — handle safely.
    log.info("chat update skipped (session missing or unauthorized)", {
      chatId: run.chatId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function finalizeFailure(
  run: DeepAnalysisRun,
  reason: string,
): Promise<void> {
  const composed = composeDeepAnalysisUpdate({
    locale: run.locale,
    phase: "failure",
  });
  await appendChatUpdate(run, composed.text);

  if (run.recommendationId != null) {
    try {
      await appendRecommendationHistory({
        userId: run.userId,
        recommendationId: run.recommendationId,
        kind: "research_completion",
        actor: "deep_analysis",
        source: "research_service",
        payload: {
          analysisId: run.analysisId,
          status: "failed",
          reason,
          originalDecisionPreserved: true,
          executionTriggered: false,
        },
      });
    } catch (err) {
      log.info("history append skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await updateDeepAnalysisRun(run.userId, run.analysisId, {
    status: "failed",
    internalProgress: "failed",
    failureReason: reason,
    completedAt: Date.now(),
    uxUpdateCount: Math.min(3, run.uxUpdateCount + 1),
  });
}

async function finalizeSuccess(
  run: DeepAnalysisRun,
  job: {
    status?: string;
    result_summary?: string | null;
    job_id?: string;
  },
): Promise<void> {
  // Tenant ownership recheck
  const owned = await getDeepAnalysisRun(run.userId, run.analysisId);
  if (!owned || owned.userId !== run.userId) return;

  const scored = scoreCompletedResearchJob(job);
  const bundle = emptyBundle(scored.delta, scored.agreement);
  const projection: UserSafeResearchProjection = toUserSafeResearchProjection(
    bundle,
    { deeperVerification: "completed" },
  );

  const recommendationId =
    run.recommendationId ??
    (await resolveCanonicalRecommendationId(run.userId, run.recommendationRef));

  if (recommendationId != null) {
    const rec = await getCanonicalRecommendation(run.userId, recommendationId);
    if (!rec) {
      // Recommendation gone / wrong tenant — do not resurrect.
      await updateDeepAnalysisRun(run.userId, run.analysisId, {
        status: "discarded",
        failureReason: "recommendation_missing_or_unauthorized",
        completedAt: Date.now(),
        resultProjectionJson: JSON.stringify(projection),
      });
      return;
    }

    if (isTerminalRecommendationStatus(rec.status)) {
      await appendRecommendationHistory({
        userId: run.userId,
        recommendationId,
        kind: "research_completion",
        actor: "deep_analysis",
        source: "research_service",
        payload: {
          analysisId: run.analysisId,
          status: "completed_ignored_terminal",
          originalStatus: rec.status,
          originalDecisionPreserved: true,
          historicalEvidenceTendency: scored.delta,
          executionTriggered: false,
        },
      });
    } else {
      await appendRecommendationHistory({
        userId: run.userId,
        recommendationId,
        kind: "research_completion",
        actor: "deep_analysis",
        source: "research_service",
        payload: {
          analysisId: run.analysisId,
          status: "completed",
          originalDirection: rec.direction,
          originalConfidence: rec.confidence,
          historicalEvidenceTendency: scored.delta,
          agreement: scored.agreement,
          metricsPresent: scored.metricsPresent,
          executionTriggered: false,
        },
      });

    }
  }

  if (scored.delta < 0) {
    projection.historicalAgreement = "conflicts";
    projection.notes = [
      ...projection.notes,
      "Historical evidence conflicts with the live thesis; the original analytical decision remains unchanged.",
    ];
  }

  const composed = composeDeepAnalysisUpdate({
    locale: run.locale,
    phase: "completion",
    projection,
  });
  await appendChatUpdate(run, composed.text);

  await updateDeepAnalysisRun(run.userId, run.analysisId, {
    status: "completed",
    internalProgress: "ready",
    completedAt: Date.now(),
    resultProjectionJson: JSON.stringify(projection),
    uxUpdateCount: Math.min(3, run.uxUpdateCount + 1),
  });
}

/** Restart reconcile — resume pending polls without executing trades. */
export async function reconcilePendingDeepAnalysis(): Promise<number> {
  const pending = await listPendingDeepAnalysisRuns(50);
  let n = 0;
  const { enqueue } = await import("@/lib/queue");
  for (const run of pending) {
    if (!run.researchJobId || !run.sessionId) continue;
    await enqueue("deep_analysis_poll", {
      userId: run.userId,
      analysisId: run.analysisId,
      researchJobId: run.researchJobId,
      sessionId: run.sessionId,
      recommendationId: run.recommendationId,
      generation: run.generation,
    });
    n += 1;
  }
  return n;
}
