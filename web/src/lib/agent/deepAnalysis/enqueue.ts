/**
 * Enqueue Deep Analysis via Research Service + BullMQ poller.
 * Never blocks the chat turn; never executes trades.
 */
import { createLogger } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import {
  researchBacktestEnabled,
  researchServiceEnabled,
} from "@/lib/research/client";
import { runForexBacktest } from "@/lib/research/jobs";
import { exportAiChartCandleWarehouse } from "@/lib/research/warehouse";
import type { ResearchTimeframe } from "@/lib/research/types";
import {
  buildGeneralizableStrategySpec,
  type StrategySpecBuildInput,
} from "./strategySpec";
import {
  createDeepAnalysisRun,
  findActiveDeepAnalysisByFingerprint,
  nextDeepAnalysisGeneration,
  updateDeepAnalysisRun,
  type DeepAnalysisRun,
} from "./store";
import type { DeepAnalysisAllowReason } from "./triggers";

const log = createLogger("deepAnalysis.enqueue");

const RESEARCH_TF = new Set<string>([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);

function asResearchTf(interval: string): ResearchTimeframe | null {
  const n = interval.trim().toLowerCase();
  return RESEARCH_TF.has(n) ? (n as ResearchTimeframe) : null;
}

export interface EnqueueDeepAnalysisInput {
  userId: number;
  analysisId: string;
  sessionId: string;
  chatId?: string | null;
  messageId?: string | null;
  recommendationId?: number | null;
  recommendationRef?: string | null;
  locale: "ar" | "en";
  allowReason: DeepAnalysisAllowReason;
  strategyInput: StrategySpecBuildInput;
}

export type EnqueueDeepAnalysisResult =
  | {
      ok: true;
      run: DeepAnalysisRun;
      created: boolean;
      researchJobId: string;
    }
  | {
      ok: false;
      reason: string;
      detail?: string;
    };

export async function enqueueDeepAnalysis(
  input: EnqueueDeepAnalysisInput,
): Promise<EnqueueDeepAnalysisResult> {
  if (!researchServiceEnabled() || !researchBacktestEnabled()) {
    return { ok: false, reason: "feature_disabled" };
  }

  const spec = buildGeneralizableStrategySpec(input.strategyInput);
  if (!spec.ok) {
    return {
      ok: false,
      reason: spec.reason,
      detail: spec.detail,
    };
  }

  const timeframe = asResearchTf(input.strategyInput.timeframe);
  if (!timeframe) {
    return {
      ok: false,
      reason: "setup_not_generalizable",
      detail: `Unsupported timeframe for warehouse export: ${input.strategyInput.timeframe}`,
    };
  }

  const existing = await findActiveDeepAnalysisByFingerprint({
    userId: input.userId,
    sessionId: input.sessionId,
    symbol: input.strategyInput.symbol,
    fingerprint: spec.fingerprint,
  });
  if (existing?.researchJobId) {
    return {
      ok: true,
      run: existing,
      created: false,
      researchJobId: existing.researchJobId,
    };
  }

  let envelope;
  try {
    envelope = await exportAiChartCandleWarehouse({
      symbol: input.strategyInput.symbol,
      timeframe,
      limit: 2000,
    });
  } catch (err) {
    log.warn("warehouse export failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: "warehouse_export_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const generation = await nextDeepAnalysisGeneration({
    userId: input.userId,
    sessionId: input.sessionId,
    symbol: input.strategyInput.symbol,
  });

  const idempotencyKey = `deep:${input.userId}:${input.strategyInput.symbol}:${timeframe}:${input.analysisId}`;

  let createdJob;
  try {
    createdJob = await runForexBacktest(
      { userId: input.userId, requestId: input.analysisId },
      {
        idempotencyKey,
        strategySpec: spec.strategySpec,
        dataset: { source: "aichart_candle_warehouse", payload: envelope },
        runConfig: {
          initialCapital: 10_000,
          accountCurrency: "USD",
          seed: 42,
          intrabarPolicy: "worst_case",
        },
        timeoutSeconds: 300,
      },
    );
  } catch (err) {
    log.warn("runForexBacktest failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: "research_job_create_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const researchJobId = createdJob.job.job_id;
  const run = await createDeepAnalysisRun({
    analysisId: input.analysisId,
    userId: input.userId,
    sessionId: input.sessionId,
    chatId: input.chatId,
    messageId: input.messageId,
    recommendationId: input.recommendationId,
    recommendationRef: input.recommendationRef,
    symbol: input.strategyInput.symbol,
    interval: input.strategyInput.timeframe,
    generation,
    allowReason: input.allowReason,
    strategyFingerprint: spec.fingerprint,
    locale: input.locale,
    researchJobId,
  });

  await updateDeepAnalysisRun(input.userId, input.analysisId, {
    status: "running",
    internalProgress: "polling",
    researchJobId,
  });

  await enqueue("deep_analysis_poll", {
    userId: input.userId,
    analysisId: input.analysisId,
    researchJobId,
    sessionId: input.sessionId,
    recommendationId: input.recommendationId ?? null,
    generation,
  });

  return {
    ok: true,
    run: (await updateDeepAnalysisRun(input.userId, input.analysisId, {
      status: "running",
      internalProgress: "polling",
    }))!,
    created: createdJob.created,
    researchJobId,
  };
}
