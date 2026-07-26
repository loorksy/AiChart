/**
 * Unified Smart Chart Agent orchestrator. Runs ONE visible agent over an
 * internal fleet of specialists, honoring: intent-based cost control (general
 * questions run no market agents), per-agent timeouts, partial-result rules
 * (a non-critical agent failing degrades gracefully), and a hard rule that
 * execution never happens without explicit confirmation.
 */
import type {
  AgentChartContext,
  AgentFinalResult,
  AgentRunContext,
} from "./types";
import type { AppLocale } from "@/lib/i18n";
import type { AgentConversationContext } from "./context";
import { contextualizeIntentMessage } from "./context";
import { newId } from "./activity";
import {
  isGeneralOnly,
  isDrawingOnly,
  isDrawActiveRecommendation,
  isUserDrawingEdit,
  needsMarketContext,
  routeIntent,
} from "./intentRouter";
import { handleUserDrawingCommand } from "./drawingCommands/handleUserDrawingCommand";
import { withTimeout, withDeadline, createRunBudget, AGENT_TIMEOUTS } from "./timeout";
import { buildInformationalResult, buildAgentFallbackResult } from "./fallback";
import {
  failureCodeFromSynthesizerKind,
  ledgerSilentTimeout,
  stageFailureFromError,
  userMessageForFailure,
  type AgentStage,
  type AgentStageFailure,
} from "./errorTaxonomy";
import { createLogger } from "@/lib/logger";
import { recordAgentOutcome, recordStageFailure } from "@/lib/metrics";
import {
  degradedStagesFrom,
  descriptiveEnvelope,
  envelopeForFinalDecision,
  operationalBlockerEnvelope,
} from "./resultEnvelope";
import { evaluateDependencies } from "./dependencyMatrix";
import { answerGeneralQuestion } from "./generalAnswer";
import { FEATURES } from "./featureFlags";
import {
  collectBoundedResearchEvidence,
} from "./researchEvidence";
import {
  compositionFallback,
  scanForInternalLeakage,
  toUserSafeResearchProjection,
} from "./userSafeOutbound";
import {
  classifyHardSafetyFailure,
  decideDeepAnalysisTrigger,
} from "./deepAnalysis/triggers";
import { enqueueDeepAnalysis } from "./deepAnalysis/enqueue";
import { composeDeepAnalysisUpdate } from "./deepAnalysis/composeUpdate";
import { updateDeepAnalysisRun } from "./deepAnalysis/store";
import {
  researchBacktestEnabled,
  researchServiceEnabled,
} from "@/lib/research/client";
import { buildInformationalConfidence } from "./confidenceSemantics";
import { runMarketDataAgent } from "./agents/marketDataAgent";
import { runStructureAgent } from "./agents/structureAgent";
import { runLiquidityAgent } from "./agents/liquidityAgent";
import { runSupplyDemandAgent } from "./agents/supplyDemandAgent";
import { runMultiTimeframeAgent } from "./agents/multiTimeframeAgent";
import { runNewsMacroAgent } from "./agents/newsMacroAgent";
import {
  runRiskAgent,
  type AccountRiskSnapshot,
  type RiskAgentResult,
} from "./agents/riskAgent";
import type { FinalDecisionResult } from "./agents/finalDecisionAgent";
import { runFinalDecisionSynthesizer } from "./agents/finalDecisionSynthesizer";
import { runDrawingAgent } from "./agents/drawingAgent";
import {
  buildDrawingPlan,
  buildDrawingCandidates,
} from "./drawings/buildDrawingPlan";
import { buildMarketNarrative } from "./marketContext/buildMarketNarrative";
import { runExecutionGuardAgent } from "./agents/executionGuardAgent";
import { resolveValidity } from "./trading/tradePlan";
import { handleDrawingCommand } from "./drawingCommands/handleDrawingCommand";
import {
  clearActiveRecommendation,
  computeRecommendationExpiry,
  getActiveRecommendation,
  isActiveRecommendationLive,
  recommendationDirectionAr,
  rememberActiveRecommendation,
  updateActiveRecommendationStatus,
  type ActiveRecommendation,
} from "./sessionRecommendation";
import { evaluateRecommendationStatus } from "./recommendation/evaluateRecommendationStatus";
import {
  composeRecommendationExplanation,
  composeRecommendationStatusAnswer,
} from "./recommendation/followupAnswer";
import { hashMarketSnapshot } from "./chartSnapshot";
import {
  loadStageCheckpoint,
  saveStageCheckpoint,
  stageCheckpointKey,
} from "./stageCheckpoint";
import type { StructureResult } from "./agents/structureAgent";
import type { LiquidityResult } from "./agents/liquidityAgent";
import type { SupplyDemandResult } from "./agents/supplyDemandAgent";
import type { MultiTimeframeResult } from "./agents/multiTimeframeAgent";
import type { NewsMacroResult } from "./agents/newsMacroAgent";
import {
  buildAgentSkillContext,
  EMPTY_SKILL_CONTEXT,
  type AgentSkillContext,
} from "./skills/skillContext";
import { bilingual, composeStatusReply } from "./statusReply";
import { contextualOptionsFor } from "./contextualOptions";
import { answerChartDrawingQuestion } from "./chartDrawingAnswer";
import { candleFreshnessToleranceMs } from "@/lib/markets/intervals";
import { detectChartGeometry } from "@/lib/chart/geometry";
import {
  createTrackedRecommendation,
  listTrackedRecommendations,
} from "@/lib/recommendations/recommendationStore";
import {
  renderLessonsForPrompt,
  summarizeTradeLessons,
  type TradeOutcomeRecord,
} from "./learningLoop";

const log = createLogger("agent.orchestrator");

/**
 * Realised-outcome lessons for the decision prompt (RELIABILITY_PLAN item 14).
 *
 * Feeds what ACTUALLY happened on this symbol back into the next decision. It
 * is strictly evidence: a failure to read history degrades to no block at all
 * rather than blocking the run, and the block itself is phrased as context to
 * weigh — the model keeps sole authority over BUY/SELL/WAIT.
 */
async function buildLessonsBlock(
  userId: number | undefined,
  symbol: string,
): Promise<string | null> {
  if (!userId || !symbol) return null;
  try {
    const tracked = await listTrackedRecommendations(userId, { limit: 60 });
    const outcomes: TradeOutcomeRecord[] = tracked
      .filter((r) => r.outcome === "loss" || r.outcome.startsWith("win_"))
      .map((r) => ({
        symbol: r.symbol,
        direction: r.direction,
        won: r.outcome.startsWith("win_"),
        rMultiple: null,
        session: null,
        closedAt: r.slHitAt ?? r.tp3HitAt ?? r.tp2HitAt ?? r.tp1HitAt ?? r.createdAt,
      }));
    return renderLessonsForPrompt(summarizeTradeLessons({ symbol, outcomes }));
  } catch (error) {
    // History is an aid, never a gate: losing it must not affect the decision.
    log.warn("agent.lessons.unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cancellation checkpoint (RELIABILITY_PLAN.md item 2). withDeadline degrades a
 * cancelled stage to its fallback rather than throwing, which keeps partial
 * results usable — but it also means a cancelled run would otherwise WALK the
 * remaining stages before finishing. Checking the run signal at stage
 * boundaries makes cancellation prompt: the run stops as soon as nobody is
 * waiting for it, which is also what frees the burst slot quickly.
 */
function cancelledRunResult(
  ctx: AgentRunContext,
  collected: AgentFinalResult["activityEvents"],
  locale: AppLocale,
): AgentFinalResult {
  return buildAgentFallbackResult("Run cancelled by the caller.", collected, locale, {
    failureStage: "general",
    failureCode: "cancelled",
    retryable: false,
    traceId: ctx.requestId,
  });
}

export interface UnifiedAgentInput {
  userMessage: string;
  chartContext?: AgentChartContext;
  requestContext: AgentRunContext;
  account?: AccountRiskSnapshot | null;
  canExecute?: boolean;
  spread?: number | null;
  /** UI locale — used to localize contextual follow-up options. */
  locale?: AppLocale;
  /** Optional, bounded language context. It is never a market-data authority. */
  conversationContext?: AgentConversationContext;
}

export async function runUnifiedChartAgent(
  input: UnifiedAgentInput,
): Promise<AgentFinalResult> {
  // Total run budget (RELIABILITY_PLAN.md item 2): one signal that aborts on a
  // client disconnect OR when the run exceeds the budget, which every I/O stage
  // links to. It stays under the MCP tool's wait so the caller always receives
  // a real envelope instead of a bare transport timeout.
  const budget = createRunBudget(input.requestContext.signal);
  const startedAt = performance.now();
  let result: AgentFinalResult;
  try {
    result = await runUnifiedChartAgentInner({
      ...input,
      requestContext: { ...input.requestContext, signal: budget.signal },
    });
  } finally {
    budget.dispose();
  }

  // A run that blew its total budget did NOT complete on full evidence. Saying
  // so is mandatory: silently returning the degraded answer would dress an
  // incomplete run up as a normal one (and re-enable usage charging).
  if (
    (budget.expired || budget.cancelledByClient) &&
    result.envelope?.outcome_class !== "operational_blocker"
  ) {
    result.envelope = operationalBlockerEnvelope({
      failureStage: "general",
      failureCode: budget.cancelledByClient ? "cancelled" : "timeout",
      retryable: !budget.cancelledByClient,
      traceId: input.requestContext.requestId,
      cancelled: budget.cancelledByClient,
      degradedStages: result.envelope?.degraded_stages,
    });
  }

  // Contract guarantee: EVERY result carries a three-state envelope. Blockers
  // and evidence-bearing finals set theirs explicitly at the return site; the
  // backstop below only labels successful answers (informational/status
  // replies) as descriptive. Any NEW fault path must attach its own
  // operationalBlockerEnvelope — the backstop will not do it for you.
  if (!result.envelope) {
    result.envelope = descriptiveEnvelope({
      recommendationIssued:
        result.recommendation?.action === "buy" ||
        result.recommendation?.action === "sell",
      traceId: input.requestContext.requestId,
    });
  }

  // Observability (item 9): the three-state ratio is the headline reliability
  // signal — a rising operational_blocker share IS the outage.
  recordAgentOutcome({
    outcome: result.envelope.outcome_class,
    executionMode: result.envelope.execution_mode,
    failureCode: result.envelope.failure_code,
    durationSeconds: (performance.now() - startedAt) / 1000,
  });
  return result;
}

async function runUnifiedChartAgentInner(
  input: UnifiedAgentInput,
): Promise<AgentFinalResult> {
  const { userMessage, chartContext, requestContext: ctx } = input;
  const locale: AppLocale = input.locale ?? "ar";
  const analysisId = newId();
  // The caller (SSE route / MCP wrapper) accumulates the emitted events and
  // merges them into the final payload — the orchestrator returns [] here.
  const collected: AgentFinalResult["activityEvents"] = [];
  const trackedCtx = ctx;

  const intents = routeIntent({
    message: contextualizeIntentMessage(userMessage, input.conversationContext),
    chartContext,
    ctx: trackedCtx,
  });
  const sessionId = ctx.sessionId ?? "default";
  let activeRecommendation =
    (await getActiveRecommendation(sessionId, chartContext?.symbol, ctx.userId)) ??
    activeRecommendationFromChartContext(sessionId, chartContext);

  // "Cancel the previous AND analyze again" → cancel first, then fall through
  // into a fresh analysis. A plain cancel stops here.
  const wantsReanalyzeAfterCancel =
    intents.includes("cancel_active_recommendation") &&
    intents.includes("new_trade_analysis");

  if (intents.includes("cancel_active_recommendation")) {
    const cancelled = activeRecommendation;
    await clearActiveRecommendation(sessionId, chartContext?.symbol, ctx.userId);
    // The old recommendation is now terminal — drop it so the no-flip-flop
    // guard cannot block the fresh analysis the user explicitly asked for.
    activeRecommendation = null;
    if (!wantsReanalyzeAfterCancel) {
      const summary = await composeStatusReply({
        situation:
          "The operator asked to cancel the active recommendation and it has been cancelled. Acknowledge naturally; no new analysis was run.",
        facts: {
          cancelled: cancelled
            ? {
                symbol: cancelled.symbol,
                direction: cancelled.direction,
                entry: cancelled.entry,
                status: cancelled.status,
              }
            : null,
        },
        locale,
        userMessage,
        fallback: bilingual(
          locale,
          "ألغيت التوصية النشطة في هذه الجلسة.",
          "The active recommendation in this session has been cancelled.",
        ),
      });
      return {
        decision: "informational",
        confidence: 0.9,
        summary,
        keyReasons: [],
        riskWarnings: [],
        activityEvents: collected,
        options: contextualOptionsFor({ decision: "informational", noActiveRecommendation: true, locale }),
      };
    }
  }

  // Draw the STORED recommendation (entry/SL/TP/invalidation) — never recompute
  // a new trade, never change direction, never run Risk/News agents.
  if (isDrawActiveRecommendation(intents)) {
    return drawStoredRecommendation(activeRecommendation, collected, locale, userMessage);
  }

  if (intents.includes("explain_active_recommendation")) {
    return explainStoredRecommendation(activeRecommendation, collected, userMessage, locale);
  }

  if (intents.includes("track_active_recommendation")) {
    return trackStoredRecommendation({
      activeRecommendation,
      chartContext,
      ctx: trackedCtx,
      collected,
      userMessage,
      locale,
    });
  }

  // User-drawing understanding / editing (discuss / move / modify / delete /
  // clarify). This NEVER runs market/risk/news agents and NEVER opens a trade —
  // it only reads the safe serialized user drawings and returns an answer or a
  // set of idempotent mutations the client applies after the final SSE. Checked
  // before explain_chart_drawings because "رأيك في رسمي" references the user's
  // OWN manual drawing, not the agent's AiChart drawings.
  if (isUserDrawingEdit(intents)) {
    return handleUserDrawingCommand({
      intents,
      userMessage,
      chartContext,
      locale,
    });
  }

  if (intents.includes("explain_chart_drawings")) {
    const summary = await withTimeout(
      answerChartDrawingQuestion({
        userMessage,
        chartContext,
        activeRecommendation,
      }),
      AGENT_TIMEOUTS.general,
      null,
    );
    if (summary == null) {
      // Deadline hit — an honest blocker, never an "ok" descriptive answer.
      return buildAgentFallbackResult(
        "Drawing explanation exceeded its deadline.",
        collected,
        locale,
        { failureStage: "general", failureCode: "timeout", retryable: true, traceId: ctx.requestId },
      );
    }
    return {
      decision: "informational",
      confidence: 0.8,
      summary,
      keyReasons: [],
      riskWarnings: [],
      activityEvents: collected,
      activeRecommendation: activeRecommendation
        ? {
            id: activeRecommendation.id,
            status: activeRecommendation.status,
            direction: activeRecommendation.direction,
            symbol: activeRecommendation.symbol,
            interval: activeRecommendation.interval,
          }
        : undefined,
      options: contextualOptionsFor({
        decision: "informational",
        hasActiveRecommendation: Boolean(activeRecommendation),
        locale,
      }),
    };
  }

  if (isDrawingOnly(intents)) {
    const drawingResult = await handleDrawingCommand({
      intents,
      chartContext,
      ctx: trackedCtx,
      locale,
      userMessage,
    });
    return {
      ...drawingResult,
      options: contextualOptionsFor({ decision: drawingResult.decision, drawingOnly: true, locale }),
    };
  }

  // General-only → answer with no market agents and NO visible activity. A real
  // agent stays silent unless it is actually running a tool; it never narrates
  // "preparing a general answer".
  if (isGeneralOnly(intents)) {
    const summary = await withTimeout(
      answerGeneralQuestion(userMessage, input.conversationContext),
      AGENT_TIMEOUTS.general,
      null,
    );
    if (summary == null) {
      return buildAgentFallbackResult(
        "General answer exceeded its deadline.",
        collected,
        locale,
        { failureStage: "general", failureCode: "timeout", retryable: true, traceId: ctx.requestId },
      );
    }
    return buildInformationalResult(summary, collected, { traceId: ctx.requestId });
  }

  const wantMarket = needsMarketContext(intents);
  const educationalOnly = Boolean(ctx.session?.preferences.educationalOnly);

  const analysisKind = "scalp" as const;

  // Canonical skill catalogue: discover metadata, select by intent/locale/
  // market, and lazily load only the relevant bodies. Read-only guidance —
  // failure degrades to zero skills and never blocks the run.
  const skillContext: AgentSkillContext =
    wantMarket && FEATURES.agentSkillsV1()
      ? buildAgentSkillContext({
          request: userMessage,
          intent: intents,
          locale,
          market: "forex",
          // Tools the chart agent can surface in this path (enables cards skill).
          availableTools: ["render_cards", "detect_levels", "get_ohlc"],
        })
      : EMPTY_SKILL_CONTEXT;

  // News-only path (news requested but no chart context needed).
  if (!wantMarket && intents.includes("market_news")) {
    const news = await withTimeout(
      runNewsMacroAgent(trackedCtx, { symbol: chartContext?.symbol, message: userMessage }),
      AGENT_TIMEOUTS.news,
      null,
    );
    const level = news?.newsRisk ?? "unknown";
    const unknownNews = level === "unknown";
    const newsSemantics = buildInformationalConfidence({
      analysisConfidence: level === "high" ? 0.6 : unknownNews ? 0.5 : 0.75,
    });
    return {
      decision: "informational",
      confidence: 0,
      confidenceSemantics: newsSemantics,
      summary: unknownNews
        ? bilingual(
            locale,
            "خطر الأخبار غير معروف لأن مزوّد الأخبار غير مفعّل، لا يمكن تأكيد خطر الأخبار حالياً.",
            "News risk is unknown because no news provider is configured — I cannot confirm news risk right now.",
          )
        : news?.reason
          ? news.reason
          : bilingual(locale, "تمت مراجعة الأخبار.", "News review completed."),
      keyReasons: [],
      riskWarnings:
        level === "high"
          ? [bilingual(locale, "خطر إخباري مرتفع قريب.", "High-impact news risk is near.")]
          : [],
      activityEvents: collected,
      newsRisk: {
        level,
        reason: news?.reason ?? "News provider is not configured.",
      },
    };
  }

  if (!wantMarket) {
    // Account-only or platform-help without market context.
    const summary = await withTimeout(
      answerGeneralQuestion(userMessage, input.conversationContext),
      AGENT_TIMEOUTS.general,
      null,
    );
    if (summary == null) {
      return buildAgentFallbackResult(
        "General answer exceeded its deadline.",
        collected,
        locale,
        { failureStage: "general", failureCode: "timeout", retryable: true, traceId: ctx.requestId },
      );
    }
    return buildInformationalResult(summary, collected, { traceId: ctx.requestId });
  }

  // --- Market fleet ---
  // Degraded-stage ledger: every specialist/provider failure is CLASSIFIED and
  // recorded here instead of vanishing into `.catch(() => null)`. The list
  // feeds envelope.degraded_stages and operator diagnostics.
  const stageFailures: AgentStageFailure[] = [];
  const captureStage = <T,>(stage: AgentStage, promise: Promise<T>): Promise<T | null> =>
    promise.catch((error) => {
      const failure = stageFailureFromError(stage, error);
      stageFailures.push(failure);
      // Observability (item 9): per-stage failure/timeout rates by taxonomy code.
      recordStageFailure({
        stage: failure.stage,
        code: failure.code,
        retryable: failure.retryable,
      });
      return null;
    });

  // Market Data Agent is CRITICAL: failure → stop, return action_required.
  // It performs network I/O (warehouse + OANDA), so it uses withDeadline: a
  // cancelled run tears the fetch down immediately instead of holding the burst
  // slot for the remainder of the stage deadline (RELIABILITY_PLAN item 2).
  const market = await withDeadline(
    (signal) =>
      captureStage(
        "market_data",
        runMarketDataAgent(
          { ...trackedCtx, signal },
          {
            ...chartContext,
            spread: input.spread,
            analysisKind,
          },
        ),
      ),
    AGENT_TIMEOUTS.marketData,
    null,
    ctx.signal,
  );

  // Cancelled during market data: stop before any further work.
  if (ctx.signal?.aborted) return cancelledRunResult(ctx, collected, locale);

  if (!market || market.currentPrice == null) {
    const marketFailure = stageFailures.find((f) => f.stage === "market_data");
    trackedCtx.emitActivity({
      type: "data",
      status: "failed",
      message: "تعذّر تجهيز بيانات السوق — لا يمكن إكمال تحليل الشارت الآن.",
      metadata: marketFailure
        ? { stage: marketFailure.stage, code: marketFailure.code }
        : { stage: "market_data", code: "timeout" },
    });
    return {
      decision: "action_required",
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        // No thrown error means withTimeout hit its deadline.
        failureCode: marketFailure?.code ?? "timeout",
        retryable: marketFailure?.retryable ?? true,
        traceId: ctx.requestId,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        "تعذّر تجهيز بيانات السوق من المخزن/OANDA. حاول مرة أخرى بعد قليل.",
        "Could not prepare market data from the warehouse/OANDA. Try again shortly.",
      ),
      keyReasons: [
        marketFailure
          ? `Market data unavailable (${marketFailure.code}).`
          : "Market data unavailable (stage deadline).",
      ],
      riskWarnings: [
        bilingual(locale, "لم تصدر توصية بسبب نقص البيانات.", "No recommendation was issued due to missing data."),
      ],
      activityEvents: collected,
      analysisId,
    };
  }

  if (!market.sync.ok) {
    return {
      decision: "action_required",
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "stale_data",
        retryable: true,
        traceId: ctx.requestId,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        "تعذّر تأكيد أحدث أسعار OANDA الآن. انتظر بضع ثوانٍ ثم أعد السؤال — لا حاجة لتحديث الصفحة.",
        "Could not confirm the latest OANDA prices right now. Wait a few seconds and ask again — no page refresh needed.",
      ),
      keyReasons: [market.sync.reason],
      riskWarnings: [
        bilingual(
          locale,
          "تعذّر تأكيد أحدث الأسعار — لم تُصدر توصية.",
          "Latest prices could not be confirmed — no recommendation was issued.",
        ),
      ],
      activityEvents: collected,
      analysisId,
      debugDecisionFlow:
        process.env.NODE_ENV === "development"
          ? {
              usedLLM: false,
              tickerGenerated: false,
              candleCount: market.currentTfCandles.length,
              htfCandleCount: market.higherTfCandles.length,
              dailyCandleCount: market.dailyCandles.length,
              selectedLevelsCount: 0,
              rejectedLevelsCount: 0,
              drawingPlanReason: "market sync failed",
              dataSource: chartContext?.dataSource ?? "oanda",
              marketSync: market.sync,
            }
          : undefined,
    };
  }

  // Gap policy v1.2: only CATASTROPHIC data loss stops the analysis (the
  // series is unusable). Significant gaps become soft evidence below — the
  // model stays the sole BUY/SELL/WAIT authority and weighs them itself.
  if (market.dataQuality.coverage.status === "gapped") {
    trackedCtx.emitActivity({
      type: "data",
      status: "failed",
      message: market.dataQuality.coverage.summaryAr,
      metadata: { ...market.dataQuality.coverage },
    });
    return {
      decision: "action_required",
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "insufficient_data",
        retryable: true,
        traceId: ctx.requestId,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        market.dataQuality.coverage.summaryAr,
        market.dataQuality.coverage.summaryEn,
      ),
      keyReasons: [market.dataQuality.coverage.summaryEn],
      riskWarnings: [
        bilingual(
          locale,
          "أُوقف التحليل لأن سلسلة الأسعار تفتقد جزءاً كبيراً من البيانات — بدأ الإصلاح التلقائي.",
          "Analysis was stopped because a large part of the price series is missing — automatic repair has started.",
        ),
      ],
      activityEvents: collected,
      analysisId,
      debugDecisionFlow:
        process.env.NODE_ENV === "development"
          ? {
              usedLLM: false,
              tickerGenerated: false,
              candleCount: market.currentTfCandles.length,
              htfCandleCount: market.higherTfCandles.length,
              dailyCandleCount: market.dailyCandles.length,
              selectedLevelsCount: 0,
              rejectedLevelsCount: 0,
              drawingPlanReason: "catastrophic open-market candle gaps",
              dataSource: chartContext?.dataSource ?? "oanda",
              marketSync: market.sync,
            }
          : undefined,
    };
  }

  // Significant (non-blocking) gaps: surface as a warning event + evidence.
  const significantGapWarning =
    market.dataQuality.coverage.gapSeverity === "significant"
      ? bilingual(
          locale,
          "توجد فجوات بيانات ملحوظة في بعض الفريمات — بدأ الإصلاح التلقائي؛ اعتُبرت الأدلة المتأثرة أضعف.",
          "Noticeable data gaps exist on some timeframes — automatic repair started; affected evidence is weighted lower.",
        )
      : null;
  if (significantGapWarning) {
    trackedCtx.emitActivity({
      type: "data",
      status: "warning",
      message: market.dataQuality.coverage.summaryAr,
      metadata: { ...market.dataQuality.coverage },
    });
  }

  // Cancelled right after market data: never start the fleet for nobody.
  if (ctx.signal?.aborted) return cancelledRunResult(ctx, collected, locale);

  // Stage checkpoint (item 2): an identical market snapshot means the fleet —
  // pure functions of the candle window — would produce identical output, so a
  // retry after a failed decision resumes instead of re-earning the evidence.
  // A changed candle changes the hash and the fleet re-runs.
  const chartSnapshotHash = hashMarketSnapshot(market, chartContext?.visibleRange);
  const checkpointKey = stageCheckpointKey({
    userId: ctx.userId,
    symbol: market.symbol,
    interval: market.interval,
  });
  const resumed = loadStageCheckpoint(checkpointKey, chartSnapshotHash);

  let structure: StructureResult | null;
  let liquidity: LiquidityResult | null;
  let supplyDemand: SupplyDemandResult | null;
  let mtf: MultiTimeframeResult | null;
  let news: NewsMacroResult | null;

  if (resumed) {
    ({ structure, liquidity, supplyDemand, mtf, news } = resumed);
  } else {
    // Structure / liquidity / S&D / MTF run concurrently; each degrades to null
    // with its failure CLASSIFIED and recorded (never a silent swallow).
    [structure, liquidity, supplyDemand, mtf] = await Promise.all([
      withTimeout(captureStage("structure", runStructureAgent(trackedCtx, market)), AGENT_TIMEOUTS.structure, null),
      withTimeout(captureStage("liquidity", runLiquidityAgent(trackedCtx, market)), AGENT_TIMEOUTS.liquidity, null),
      withTimeout(captureStage("supply_demand", runSupplyDemandAgent(trackedCtx, market)), AGENT_TIMEOUTS.supplyDemand, null),
      withTimeout(captureStage("multi_timeframe", runMultiTimeframeAgent(trackedCtx, market)), AGENT_TIMEOUTS.multiTimeframe, null),
    ]);

    // News is non-critical: failure → newsRisk unknown (handled inside agent).
    // It performs network I/O, so its deadline CANCELS the provider call.
    news = await withDeadline(
      (signal) =>
        captureStage(
          "news",
          runNewsMacroAgent(
            { ...trackedCtx, signal },
            {
              symbol: market.symbol,
              message: userMessage,
            },
          ),
        ),
      AGENT_TIMEOUTS.news,
      null,
      ctx.signal,
    );

    // Only a COMPLETE fleet is checkpointed — a degraded run must never be
    // replayed as if it were good evidence.
    if (structure && liquidity && supplyDemand && mtf) {
      saveStageCheckpoint(checkpointKey, chartSnapshotHash, {
        structure,
        liquidity,
        supplyDemand,
        mtf,
        news,
      });
    }
  }

  // Cancelled mid-fleet: stop now instead of walking the remaining stages.
  if (ctx.signal?.aborted) return cancelledRunResult(ctx, collected, locale);

  // Silent deadlines never throw, so ledger them explicitly — otherwise a run
  // whose whole fleet timed out would still report operational_status "ok".
  // They also bypass captureStage, so they must be counted here or the stage
  // timeout metric would read zero during exactly the outage it exists for.
  // (errorTaxonomy is client-bundled — metrics can only be recorded here.)
  const ledgeredBefore = stageFailures.length;
  ledgerSilentTimeout(stageFailures, "structure", structure, AGENT_TIMEOUTS.structure);
  ledgerSilentTimeout(stageFailures, "liquidity", liquidity, AGENT_TIMEOUTS.liquidity);
  ledgerSilentTimeout(stageFailures, "supply_demand", supplyDemand, AGENT_TIMEOUTS.supplyDemand);
  ledgerSilentTimeout(stageFailures, "multi_timeframe", mtf, AGENT_TIMEOUTS.multiTimeframe);
  ledgerSilentTimeout(stageFailures, "news", news, AGENT_TIMEOUTS.news);
  for (const failure of stageFailures.slice(ledgeredBefore)) {
    recordStageFailure({
      stage: failure.stage,
      code: failure.code,
      retryable: failure.retryable,
    });
  }

  // The evidence builder prepares price-valid candidates for the model. It is
  // not a policy gate and it does not own BUY/SELL/WAIT.
  let risk: RiskAgentResult | null = null;
  try {
    risk = await withTimeout(
      runRiskAgent(trackedCtx, {
        market,
        structure,
        supplyDemand,
        liquidity,
        mtf,
        news,
        account: input.account ?? null,
        educationalOnly,
        chartDrawings: chartContext?.drawings,
      }),
      AGENT_TIMEOUTS.risk,
      null,
    );
  } catch (error) {
    stageFailures.push(stageFailureFromError("risk", error));
    risk = null;
  }
  if (!risk) {
    const riskFailure = stageFailures.find((f) => f.stage === "risk");
    trackedCtx.emitActivity({
      type: "risk",
      status: "failed",
      message: "تعذّر إكمال فحص المخاطر — القرار انتظار احترازياً.",
      metadata: { stage: "risk", code: riskFailure?.code ?? "timeout" },
    });
    return buildAgentFallbackResult(
      "Risk agent failed — defaulting to WAIT.",
      collected,
      locale,
      {
        failureStage: "risk",
        failureCode: riskFailure?.code ?? "timeout",
        retryable: riskFailure?.retryable ?? true,
        traceId: ctx.requestId,
      },
    );
  }

  const decisionInput = {
    userMessage,
    risk,
    news,
    market,
    structure,
    supplyDemand,
    mtf,
    chartDrawings: chartContext?.drawings,
  };

  // Detector output becomes candidates the synthesizer may select from —
  // detectors NEVER draw directly.
  const candidates = buildDrawingCandidates({
    market,
    structure,
    supplyDemand,
    liquidity,
    mtf,
  });

  // Deterministic chart geometry (trendlines, channels, patterns with
  // forming/completed state) — computed ONCE and shared by the synthesizer
  // evidence, the drawing plan, and every render surface downstream.
  const geometry = detectChartGeometry({
    candles: market.currentTfCandles,
    atr: market.atr,
  });

  // Evidence-based chart story for the synthesizer (real detector output only).
  const narrative = buildMarketNarrative({ market, structure, liquidity, mtf });

  // The LLM chooses BUY, SELL, or WAIT and binds actionable choices to a real
  // candidate. Model failure produces a technical no-recommendation state.
  // Cancelled before the decision: never pay for the most expensive call when
  // the answer has no reader.
  if (ctx.signal?.aborted) return cancelledRunResult(ctx, collected, locale);

  // Realised-outcome lessons are read BEFORE the decision call so the
  // deadline-wrapped callback stays synchronous (item 14).
  const lessonsBlock = await buildLessonsBlock(ctx.userId, market.symbol);

  let synthError: unknown = null;
  // withDeadline (not withTimeout): the decision call is the single most
  // expensive stage, so its deadline must actually ABORT the provider request
  // rather than leave it running behind an answer the user already received.
  const synth = await withDeadline(
    (signal) =>
      runFinalDecisionSynthesizer(
        { ...trackedCtx, signal },
        {
          ...decisionInput,
          candidates,
          narrative,
          geometry,
          locale,
          skillContextBlock: skillContext.block || null,
          // Realised-outcome lessons (item 14): evidence the model weighs.
          lessonsBlock,
        },
      ).catch((err) => {
        synthError = err;
        return null;
      }),
    AGENT_TIMEOUTS.finalDecision,
    null,
    ctx.signal,
  );
  if (!synth) {
    // withTimeout resolves to null on deadline; a thrown error is a real fault.
    const thrownFailure = synthError
      ? stageFailureFromError("final_decision", synthError)
      : null;
    const code = thrownFailure?.code ?? "timeout";
    // Operator-only raw cause → server logs (correlated by requestId). It must
    // NEVER reach the user-facing activity/summary (RELIABILITY_PLAN item 7).
    const operatorReason = synthError
      ? `Decision model call threw: ${
          synthError instanceof Error ? synthError.message : String(synthError)
        }`
      : `Decision model exceeded its ${AGENT_TIMEOUTS.finalDecision / 1000}s deadline.`;
    log.warn("agent.final_decision.failed", {
      requestId: ctx.requestId,
      cause: synthError ? "threw" : "timeout",
      code,
      detail: operatorReason,
    });
    trackedCtx.emitActivity({
      type: "analysis",
      status: "failed",
      message: userMessageForFailure(code, locale),
      metadata: { stage: "final_decision", cause: synthError ? "threw" : "timeout" },
    });
    return buildAgentFallbackResult(operatorReason, collected, locale, {
      retryable: thrownFailure ? thrownFailure.retryable : true,
      failureStage: "final_decision",
      failureCode: code,
      traceId: ctx.requestId,
    });
  }
  if (!synth.usedLLM || !synth.result) {
    // The synthesizer reports WHY (provider auth, rate limit, malformed reply…)
    // for OPERATORS. The user only ever sees the safe taxonomy message.
    const failure = synth.failure;
    const code = failure ? failureCodeFromSynthesizerKind(failure.kind) : "unknown";
    // Operator-only raw cause → server logs; never the user-facing surface.
    const operatorReason = failure
      ? `Decision model failed (${failure.kind}, ${failure.attempts} attempt(s)): ${failure.detail}`
      : "Decision model was unavailable — no market recommendation was issued.";
    log.warn("agent.final_decision.unavailable", {
      requestId: ctx.requestId,
      kind: failure?.kind ?? "unknown",
      code,
      detail: failure?.detail,
    });
    trackedCtx.emitActivity({
      type: "analysis",
      status: "failed",
      message: userMessageForFailure(code, locale),
      metadata: { stage: "final_decision", kind: failure?.kind ?? "unknown" },
    });
    return buildAgentFallbackResult(operatorReason, collected, locale, {
      retryable: failure?.retryable ?? false,
      failureStage: "final_decision",
      failureCode: code,
      traceId: ctx.requestId,
    });
  }
  const finalDecision = synth.result;
  // Attach the significant-gap warning once — every downstream return path
  // (guard blocks, confirmation, final result) reuses finalDecision.riskWarnings.
  if (significantGapWarning) {
    finalDecision.riskWarnings = [
      significantGapWarning,
      ...finalDecision.riskWarnings,
    ];
  }
  // chartSnapshotHash was computed before the fleet (it also keys the stage
  // checkpoint) — the market window cannot change mid-run, so it is reused.

  // Build the drawing plan: the single source of truth for what may be drawn.
  // Weak fractals, thin data, and directionless WAITs all resolve to no drawing.
  const drawingPlan = buildDrawingPlan({
    decision: finalDecision,
    market,
    structure,
    supplyDemand,
    liquidity,
    mtf,
    geometry,
    preferMinimalDrawings: ctx.session?.preferences.preferMinimalDrawings,
    selectedCandidateIds: synth.selectedCandidateIds,
    drawingAdvice: synth.drawingAdvice ?? null,
  });

  // Drawings are non-critical: failure → return text result without drawings.
  let drawings = await withTimeout(
    runDrawingAgent(trackedCtx, {
      analysisId,
      market,
      finalDecision,
      plan: drawingPlan,
    }).catch((error) => {
      stageFailures.push(stageFailureFromError("drawing", error));
      return [] as AgentFinalResult["drawings"];
    }),
    AGENT_TIMEOUTS.drawing,
    [] as AgentFinalResult["drawings"],
  );
  drawings = drawings ?? [];

  const debugDecisionFlow: AgentFinalResult["debugDecisionFlow"] =
    process.env.NODE_ENV === "development"
      ? {
          usedLLM: synth.usedLLM,
          // Ticker state is owned by the SSE route; it overwrites these.
          tickerGenerated: false,
          candleCount: market.currentTfCandles.length,
          htfCandleCount: market.higherTfCandles.length,
          dailyCandleCount: market.dailyCandles.length,
          selectedLevelsCount:
            drawingPlan.selectedLevels.length + drawingPlan.selectedZones.length,
          rejectedLevelsCount: Math.max(
            0,
            (structure?.support.length ?? 0) +
              (structure?.resistance.length ?? 0) +
              (supplyDemand?.zones.length ?? 0) -
              drawingPlan.selectedLevels.length -
              drawingPlan.selectedZones.length,
          ),
          drawingPlanReason: drawingPlan.reason,
          dataSource: chartContext?.dataSource ?? "oanda",
          chartSnapshotHash,
          marketSync: market.sync,
        }
      : undefined;

  // Execution intent → Execution Guard (never auto-executes).
  let requiresConfirmation: boolean | undefined;
  let confirmationPayload: AgentFinalResult["confirmationPayload"];
  if (
    intents.includes("trade_execution") || intents.includes("trade_management")
  ) {
    const guard = await withTimeout(
      captureStage(
        "execution_guard",
        runExecutionGuardAgent(trackedCtx, {
          market,
          finalDecision,
          news,
          canExecute: Boolean(input.canExecute),
        }),
      ),
      AGENT_TIMEOUTS.risk,
      null,
    );
    if (!guard) {
      // Guard failure → block execution (safe default). The ANALYSIS itself
      // succeeded, so this stays a descriptive answer with the guard stage
      // marked degraded — execution authority is simply not granted.
      return {
        decision: "action_required",
        envelope: descriptiveEnvelope({
          recommendationIssued:
            finalDecision.recommendation.action === "buy" ||
            finalDecision.recommendation.action === "sell",
          traceId: ctx.requestId,
          degradedStages: degradedStagesFrom([
            ...stageFailures,
            { stage: "execution_guard", code: "timeout", retryable: true, operatorDetail: "guard unavailable" },
          ]),
        }),
        confidence: finalDecision.confidence,
        summary: bilingual(
          locale,
          "تعذّر التحقق من شروط التنفيذ — لن يُنفّذ شيء دون تأكيد.",
          "Could not verify execution conditions — nothing will be executed without confirmation.",
        ),
        keyReasons: ["Execution guard failed."],
        riskWarnings: finalDecision.riskWarnings,
        activityEvents: collected,
        drawings,
        recommendation: finalDecision.recommendation,
        analysisId,
      };
    }
    if (guard.requiresConfirmation) {
      requiresConfirmation = true;
      confirmationPayload = guard.confirmationPayload;
      return {
        decision: "action_required",
        envelope: descriptiveEnvelope({
          recommendationIssued:
            finalDecision.recommendation.action === "buy" ||
            finalDecision.recommendation.action === "sell",
          traceId: ctx.requestId,
          degradedStages: degradedStagesFrom(stageFailures),
        }),
        confidence: finalDecision.confidence,
        summary: guard.message,
        keyReasons: guard.reasons,
        riskWarnings: [...finalDecision.riskWarnings, ...guard.warnings],
        activityEvents: collected,
        recommendation: finalDecision.recommendation,
        drawings,
        newsRisk: news
          ? { level: news.newsRisk, reason: news.reason }
          : undefined,
        analysisId,
        requiresConfirmation,
        confirmationPayload,
      };
    }
    // Guard blocked (not confirmable) → action_required with the block reason.
    return {
      decision: "action_required",
      envelope: descriptiveEnvelope({
        recommendationIssued:
          finalDecision.recommendation.action === "buy" ||
          finalDecision.recommendation.action === "sell",
        traceId: ctx.requestId,
        degradedStages: degradedStagesFrom(stageFailures),
      }),
      confidence: finalDecision.confidence,
      summary: guard.message,
      keyReasons: guard.reasons,
      riskWarnings: [...finalDecision.riskWarnings, ...guard.warnings],
      activityEvents: collected,
      recommendation: finalDecision.recommendation,
      drawings,
      analysisId,
    };
  }

  // Intelligent research: reliability-weighted influence only; never fabricate usage.
  const researchEvidence = await collectBoundedResearchEvidence({
    userId: ctx.userId,
    requestId: ctx.requestId,
    symbol: market.symbol,
    interval: market.interval,
    actionableCandidate:
      finalDecision.decision === "buy" || finalDecision.decision === "sell",
    decision:
      finalDecision.decision === "buy" || finalDecision.decision === "sell"
        ? finalDecision.decision
        : "wait",
    baseConfidence: finalDecision.confidence,
    dataQualityScore:
      typeof finalDecision.confidenceSemantics.dataQuality === "number"
        ? finalDecision.confidenceSemantics.dataQuality
        : undefined,
    newsRisk: news?.newsRisk ?? "unknown",
    userMessage,
    latencyBudgetMs: 900,
  });
  // User-safe projection → model keeps natural summary; no module-name append.
  const historicalInsufficient = researchEvidence.contributions.some(
    (c) =>
      c.system === "backtest" &&
      (c.reason === "justified_but_no_completed_job_in_latency_budget" ||
        c.reason === "insufficient_historical_metrics"),
  );
  const conflictingEvidence =
    researchEvidence.historicalEvidenceTendency < -0.04 ||
    researchEvidence.contributions.some((c) =>
      /disagree|conflict|weakness/i.test(c.reason),
    );

  const hard = classifyHardSafetyFailure({
    syncOk: market.sync.ok,
    stalePrice: !market.freshness.isFresh && market.marketOpen,
    candleInsufficientUnrecoverable:
      market.dataQuality.coverage?.status === "insufficient" &&
      !market.dataQuality.coverage?.sufficientForTrade,
    executionGuardRejected: false,
  });

  let deepAnalysisId: string | undefined;
  let deeperVerification:
    | "not_started"
    | "started"
    | "skipped_not_generalizable" = "not_started";

  const deepTrigger = decideDeepAnalysisTrigger({
    decision: finalDecision.decision,
    confidence: finalDecision.confidence,
    userMessage,
    hardSafetyOrLiveDataFailure: hard.blocked,
    hardFailureCode: hard.code,
    historicalConfirmationInsufficient: historicalInsufficient,
    conflictingEvidence,
    novelOrWeakSetup:
      (finalDecision.decision === "buy" || finalDecision.decision === "sell") &&
      finalDecision.confidence < 0.55,
    researchServiceEnabled: researchServiceEnabled(),
    researchBacktestEnabled: researchBacktestEnabled(),
  });

  let storedRecommendation: ActiveRecommendation | null = null;
  if (
    finalDecision.decision === "buy" ||
    finalDecision.decision === "sell"
  ) {
    storedRecommendation = await storeFinalRecommendation({
      sessionId,
      userId: ctx.userId,
      layoutId: chartContext?.layoutId,
      analysisId,
      scalp: true,
      market,
      finalDecision,
      risk,
      drawings,
      chartSnapshotHash,
    });
  }

  if (deepTrigger.run && ctx.userId && deepTrigger.allowReason) {
    const direction =
      finalDecision.decision === "buy" || finalDecision.decision === "sell"
        ? finalDecision.decision
        : storedRecommendation?.direction ?? "buy";
    const deepId = `deep-${analysisId}`;
    deepAnalysisId = deepId;
    const enqueued = await enqueueDeepAnalysis({
      userId: ctx.userId,
      analysisId: deepId,
      sessionId,
      chatId: sessionId,
      recommendationId: null,
      recommendationRef: storedRecommendation?.id ?? null,
      locale,
      allowReason: deepTrigger.allowReason,
      strategyInput: {
        symbol: market.symbol,
        timeframe: market.interval,
        direction,
        marketRegime: typeof market.marketRegime === "string" ? market.marketRegime : null,
        structureBias:
          finalDecision.decision === "buy"
            ? "bullish"
            : finalDecision.decision === "sell"
              ? "bearish"
              : null,
        zoneType:
          risk.selectedCandidate?.poi.type === "demand" ||
          risk.selectedCandidate?.poi.type === "supply"
            ? risk.selectedCandidate.poi.type
            : null,
        confirmationRule: risk.selectedCandidate?.setupType ?? null,
        atr: market.atr,
        entry: finalDecision.recommendation.entry ?? storedRecommendation?.entry,
        stopLoss:
          finalDecision.recommendation.stop_loss ??
          storedRecommendation?.stopLoss,
        targets:
          finalDecision.recommendation.targets ??
          storedRecommendation?.targets,
        invalidationLevel: storedRecommendation?.invalidationLevel,
      },
    }).catch((err) => {
      return {
        ok: false as const,
        reason: "enqueue_error",
        detail: err instanceof Error ? err.message : String(err),
      };
    });

    if (enqueued.ok) {
      deeperVerification = "started";
      const startCopy = composeDeepAnalysisUpdate({
        locale,
        phase: "start",
      });
      // Fold start notice into summary naturally (one start update).
      if (!scanForInternalLeakage(finalDecision.summary).length) {
        finalDecision.summary = `${finalDecision.summary.trim()}\n\n${startCopy.text}`;
      }
      await updateDeepAnalysisRun(ctx.userId, deepId, {
        uxUpdateCount: 1,
        recommendationId: null,
      }).catch(() => null);
    } else if (enqueued.reason === "setup_not_generalizable") {
      deeperVerification = "skipped_not_generalizable";
      // Internal only — recorded on researchEvidence path via runTrace callers.
    }
  }

  const projection = toUserSafeResearchProjection(researchEvidence, {
    deeperVerification,
  });

  // Final leakage scan on user-visible text; regenerate once via fallback if needed.
  const leakHits = [
    ...scanForInternalLeakage(finalDecision.summary),
    ...(finalDecision.publicReasoningSummary ?? []).flatMap((l) =>
      scanForInternalLeakage(l),
    ),
  ];
  let compositionFallbackUsed = false;
  if (leakHits.length) {
    const fb = compositionFallback({
      locale,
      decision: finalDecision.decision,
      projection,
    });
    finalDecision.summary = fb.text;
    compositionFallbackUsed = true;
    // Strip any leaked public reasoning lines.
    finalDecision.publicReasoningSummary = (
      finalDecision.publicReasoningSummary ?? []
    ).filter((l) => scanForInternalLeakage(l).length === 0);
  }

  // Three-state envelope for the finished analysis. `execution_validated`
  // requires ACTUALLY-USED validated historical evidence (backtest/validation
  // contribution with status "used") — a model BUY/SELL alone stays
  // descriptive. Today the request path never grants that (see
  // researchEvidence.ts), so this labels honestly rather than optimistically.
  const actionableRecommendation =
    finalDecision.decision === "buy" || finalDecision.decision === "sell";
  const usedContributions = researchEvidence.contributions.filter(
    (c) => c.status === "used",
  );
  // Dependency matrix (item 5): a stage loss is labelled by POLICY, not by
  // ad-hoc checks. It can only pull the outcome to a safer state — losing
  // recommendation-critical evidence (risk / structure / liquidity / S&D / MTF)
  // forbids an execution-grade label even when the evidence check passed.
  const dependencyPolicy = evaluateDependencies(stageFailures);
  const envelope = envelopeForFinalDecision({
    actionableRecommendation,
    validatedEvidence:
      dependencyPolicy.allowsRecommendation &&
      usedContributions.some(
        (c) => c.system === "backtest" || c.system === "validation",
      ),
    partialEvidence: usedContributions.length > 0,
    traceId: ctx.requestId,
    degradedStages: degradedStagesFrom(stageFailures),
  });

  return {
    decision: finalDecision.decision,
    envelope,
    confidence: finalDecision.confidence,
    confidenceSemantics: finalDecision.confidenceSemantics,
    summary: finalDecision.summary,
    keyReasons: finalDecision.keyReasons,
    riskWarnings: finalDecision.riskWarnings,
    recommendation: storedRecommendation
      ? {
          ...finalDecision.recommendation,
          id: storedRecommendation.id,
          status: storedRecommendation.status,
          triggerCondition: storedRecommendation.triggerCondition,
          invalidationLevel: storedRecommendation.invalidationLevel,
          invalidationRule: storedRecommendation.invalidationRule,
          chartSnapshotHash,
        }
      : finalDecision.recommendation,
    drawings,
    newsRisk: news ? { level: news.newsRisk, reason: news.reason } : undefined,
    activityEvents: collected,
    analysisId,
    selectedSkills: skillContext.loaded.length ? skillContext.loaded : undefined,
    skillLoadFailures: skillContext.failed.length ? skillContext.failed : undefined,
    // Full research kept for runTrace/admin — stripped before client SSE.
    researchEvidence: {
      ...researchEvidence,
      // Attach projection + deep analysis meta for traces only.
      timeline: [
        ...researchEvidence.timeline,
        {
          step: "user_safe_projection",
          status: "completed",
          reason: projection.historicalAgreement,
        },
        ...(deepAnalysisId
          ? [
              {
                step: "deep_analysis",
                status:
                  deeperVerification === "started"
                    ? ("used" as const)
                    : ("skipped" as const),
                reason: deepTrigger.allowReason ?? deepTrigger.blockReason,
              },
            ]
          : []),
        ...(compositionFallbackUsed
          ? [
              {
                step: "composition_fallback",
                status: "completed" as const,
                reason: "leakage_or_compose_failure",
              },
            ]
          : []),
      ],
    },
    evidenceTimeline: researchEvidence.timeline,
    candleCoverage: market.dataQuality.coverage,
    recommendationId: storedRecommendation?.id,
    activeRecommendation: storedRecommendation
      ? {
          id: storedRecommendation.id,
          status: storedRecommendation.status,
          direction: storedRecommendation.direction,
          symbol: storedRecommendation.symbol,
          interval: storedRecommendation.interval,
        }
      : undefined,
    publicReasoningSummary: finalDecision.publicReasoningSummary,
    debugDecisionFlow,
    options: contextualOptionsFor({
      decision: finalDecision.decision,
      hasActiveRecommendation: Boolean(storedRecommendation),
      locale,
    }),
  };
}

/**
 * True when a timeframe's latest candle is too old to trust for a trade
 * decision. A closed market (weekend) never counts as stale. Uses a generous
 * multiple of the bar tolerance since higher timeframes update slowly.
 */
function isTimeframeStale(
  lastCandleTime: number | null,
  interval: string,
  marketOpen: boolean,
): boolean {
  if (!marketOpen) return false;
  if (lastCandleTime == null) return true;
  const ageMs = Date.now() - lastCandleTime;
  const tolerance = candleFreshnessToleranceMs(interval) * 3;
  return ageMs > tolerance;
}

async function noStoredRecommendation(
  collected: AgentFinalResult["activityEvents"],
  locale: AppLocale = "ar",
  userMessage?: string,
): Promise<AgentFinalResult> {
  const summary = await composeStatusReply({
    situation:
      "The operator referenced a saved recommendation, but no recommendation is stored in this session. Say so honestly and let them decide what to do next.",
    facts: { storedRecommendation: null },
    locale,
    userMessage,
    fallback: bilingual(
      locale,
      "لا توجد توصية محفوظة في هذه الجلسة حاليًا.",
      "There is no saved recommendation in this session right now.",
    ),
  });
  return {
    decision: "informational",
    confidence: 0.75,
    summary,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: collected,
    options: contextualOptionsFor({ decision: "informational", noActiveRecommendation: true, locale }),
  };
}

function activeRecommendationFromChartContext(
  sessionId: string,
  chartContext?: AgentChartContext,
): ActiveRecommendation | null {
  const rec = chartContext?.recommendation;
  if (!rec || (rec.action !== "buy" && rec.action !== "sell")) return null;
  if (rec.entry == null || rec.stop_loss == null) return null;
  const targets = rec.targets?.length
    ? rec.targets
    : rec.take_profit != null
      ? [rec.take_profit]
      : [];
  if (!targets.length) return null;
  return {
    id: `chart-${sessionId}-${chartContext?.symbol ?? "symbol"}`,
    analysisId: chartContext?.layoutId ?? "chart-context",
    sessionId,
    layoutId: chartContext?.layoutId,
    symbol: chartContext?.symbol ?? "UNKNOWN",
    interval: chartContext?.interval ?? "unknown",
    createdAt: chartContext?.latestCandle?.time ?? Date.now(),
    createdCandleTime: chartContext?.latestCandle?.time,
    direction: rec.action,
    entry: rec.entry,
    entryType: rec.entryType,
    stopLoss: rec.stop_loss,
    targets,
    takeProfit: rec.take_profit ?? targets[0],
    rr: rec.rr,
    status: "pending_entry",
    triggerCondition: "توصية مستعادة من الشارت الحالي.",
    invalidationLevel: rec.stop_loss,
    invalidationRule:
      rec.action === "buy"
        ? `إغلاق شمعة تحت ${rec.stop_loss} يبطل السيناريو.`
        : `إغلاق شمعة فوق ${rec.stop_loss} يبطل السيناريو.`,
    summary: "توصية مستعادة من الرسم/التخطيط الحالي على الشارت.",
    keyReasons: ["التوصية موجودة على الشارت الحالي وتم استخدامها كسياق للمتابعة."],
    riskWarnings: [],
    publicReasoningSummary: [],
    priceAtCreation: chartContext?.latestCandle?.close,
  };
}

/**
 * Re-draws the STORED active recommendation using the drawings captured when it
 * was created. It never recomputes a trade, changes direction, or runs any
 * market/risk agent — it only re-emits the saved overlay.
 */
async function drawStoredRecommendation(
  rec: ActiveRecommendation | null,
  collected: AgentFinalResult["activityEvents"],
  locale: AppLocale = "ar",
  userMessage?: string,
): Promise<AgentFinalResult> {
  if (!isActiveRecommendationLive(rec)) {
    const summary = await composeStatusReply({
      situation:
        "The operator asked to draw the active recommendation, but no live recommendation exists to draw. Say so honestly; a fresh analysis or recommendation is needed first.",
      facts: { activeRecommendation: null },
      locale,
      userMessage,
      fallback: bilingual(
        locale,
        "لا توجد توصية نشطة لأرسم تفاصيلها.",
        "There is no active recommendation to draw.",
      ),
    });
    return {
      decision: "informational",
      confidence: 0.7,
      summary,
      keyReasons: [],
      riskWarnings: [],
      activityEvents: collected,
      options: contextualOptionsFor({ decision: "informational", noActiveRecommendation: true, locale }),
    };
  }
  const drawings = rec.drawings ?? [];
  const summary = await composeStatusReply({
    situation: drawings.length
      ? "The stored active recommendation has been re-drawn on the chart (entry, stop, targets, invalidation). No new recommendation was created and no direction changed — describe what is now visible."
      : "The active recommendation exists but has no saved drawings to re-display. Explain that honestly.",
    facts: {
      recommendation: {
        symbol: rec.symbol,
        interval: rec.interval,
        direction: rec.direction,
        entry: rec.entry,
        stopLoss: rec.stopLoss,
        targets: rec.targets,
        status: rec.status,
        invalidationRule: rec.invalidationRule,
      },
      drawingsRedrawn: drawings.length,
    },
    locale,
    userMessage,
    fallback: drawings.length
      ? bilingual(
          locale,
          `رسمت تفاصيل التوصية النشطة (${recommendationDirectionAr(rec.direction)} على ${rec.symbol}): الدخول والوقف والأهداف. لم أُنشئ توصية جديدة.`,
          `Re-drew the active ${rec.direction} recommendation on ${rec.symbol}: entry, stop, and targets. No new recommendation was created.`,
        )
      : bilingual(
          locale,
          "التوصية النشطة موجودة لكن لا توجد رسومات محفوظة لها لإعادة عرضها.",
          "The active recommendation exists but has no saved drawings to re-display.",
        ),
  });
  return {
    decision: "informational",
    confidence: 0.85,
    summary,
    keyReasons: [
      `${rec.direction} ${rec.symbol} @ ${rec.entry}`,
      `SL ${rec.stopLoss} → TP ${rec.targets.join(", ")}`,
    ],
    riskWarnings: [],
    activityEvents: collected,
    drawings,
    analysisId: rec.analysisId,
    recommendationId: rec.id,
    activeRecommendation: {
      id: rec.id,
      status: rec.status,
      direction: rec.direction,
      symbol: rec.symbol,
      interval: rec.interval,
    },
    options: contextualOptionsFor({ decision: rec.direction, hasActiveRecommendation: true, locale }),
  };
}

async function explainStoredRecommendation(
  rec: ActiveRecommendation | null,
  collected: AgentFinalResult["activityEvents"],
  userMessage?: string,
  locale: AppLocale = "ar",
): Promise<AgentFinalResult> {
  if (!rec) return noStoredRecommendation(collected, locale, userMessage);
  const summary = await composeRecommendationExplanation({
    recommendation: rec,
    userMessage,
  });
  return {
    decision: "informational",
    confidence: 0.85,
    summary,
    keyReasons: rec.keyReasons,
    riskWarnings: rec.riskWarnings,
    activityEvents: collected,
    activeRecommendation: {
      id: rec.id,
      status: rec.status,
      direction: rec.direction,
      symbol: rec.symbol,
      interval: rec.interval,
    },
    options: contextualOptionsFor({ decision: rec.direction, hasActiveRecommendation: true, locale }),
  };
}

async function trackStoredRecommendation(input: {
  activeRecommendation: ActiveRecommendation | null;
  chartContext?: AgentChartContext;
  ctx: AgentRunContext;
  collected: AgentFinalResult["activityEvents"];
  userMessage?: string;
  locale?: AppLocale;
}): Promise<AgentFinalResult> {
  const { activeRecommendation: rec, chartContext, ctx, collected } = input;
  const locale: AppLocale = input.locale ?? "ar";
  if (!rec) return noStoredRecommendation(collected, locale, input.userMessage);

  ctx.emitActivity({
    type: "analysis",
    status: "started",
    message: "أراجع التوصية السابقة وحالتها الحالية.",
  });
  const market = await runMarketDataAgent({ ...ctx, emitActivity: () => {} }, {
    symbol: rec.symbol,
    interval: rec.interval,
    layoutId: chartContext?.layoutId,
    visibleRange: chartContext?.visibleRange,
    latestCandle: chartContext?.latestCandle,
    dataSource: chartContext?.dataSource,
  });

  if (!market.sync.ok) {
    return {
      decision: "action_required",
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "stale_data",
        retryable: true,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        "تعذّر تأكيد أحدث أسعار OANDA الآن. انتظر بضع ثوانٍ ثم أعد السؤال — لا حاجة لتحديث الصفحة.",
        "Could not confirm the latest OANDA prices right now. Wait a few seconds and ask again — no page refresh needed.",
      ),
      keyReasons: [market.sync.reason],
      riskWarnings: [],
      activityEvents: collected,
      activeRecommendation: {
        id: rec.id,
        status: rec.status,
        direction: rec.direction,
        symbol: rec.symbol,
        interval: rec.interval,
      },
    };
  }

  // Gap policy v1.2: only catastrophic loss blocks the status update;
  // significant gaps surface as a warning event and tracking continues.
  if (market.dataQuality.coverage.status === "gapped") {
    ctx.emitActivity({
      type: "data",
      status: "failed",
      message: market.dataQuality.coverage.summaryAr,
      metadata: { ...market.dataQuality.coverage },
    });
    return {
      decision: "action_required",
      envelope: operationalBlockerEnvelope({
        failureStage: "market_data",
        failureCode: "insufficient_data",
        retryable: true,
      }),
      confidence: 0,
      summary: bilingual(
        locale,
        market.dataQuality.coverage.summaryAr,
        market.dataQuality.coverage.summaryEn,
      ),
      keyReasons: [market.dataQuality.coverage.summaryEn],
      riskWarnings: [
        bilingual(
          locale,
          "أُوقف تحديث التوصية لأن سلسلة الأسعار تفتقد جزءاً كبيراً من البيانات — بدأ الإصلاح التلقائي.",
          "Recommendation status was not updated because a large part of the price series is missing — automatic repair has started.",
        ),
      ],
      activityEvents: collected,
      activeRecommendation: {
        id: rec.id,
        status: rec.status,
        direction: rec.direction,
        symbol: rec.symbol,
        interval: rec.interval,
      },
    };
  }
  if (market.dataQuality.coverage.gapSeverity === "significant") {
    ctx.emitActivity({
      type: "data",
      status: "warning",
      message: market.dataQuality.coverage.summaryAr,
      metadata: { ...market.dataQuality.coverage },
    });
  }

  const evaluated = evaluateRecommendationStatus({ recommendation: rec, market });
  await updateActiveRecommendationStatus(rec.id, evaluated.status, evaluated.reason);
  const summary = await composeRecommendationStatusAnswer({
    recommendation: rec,
    evaluation: evaluated,
    userMessage: input.userMessage,
  });
  ctx.emitActivity({
    type: "analysis",
    status: "completed",
    message: "حدّثت حالة التوصية المحفوظة.",
    metadata: { status: evaluated.status },
  });

  return {
    decision: "informational",
    confidence: 0.85,
    summary,
    keyReasons: [evaluated.reason],
    riskWarnings: rec.riskWarnings,
    activityEvents: collected,
    activeRecommendation: {
      id: rec.id,
      status: evaluated.status,
      direction: rec.direction,
      symbol: rec.symbol,
      interval: rec.interval,
    },
    options: contextualOptionsFor({ decision: rec.direction, hasActiveRecommendation: true, locale }),
  };
}

async function storeFinalRecommendation(input: {
  sessionId: string;
  userId?: number;
  layoutId?: string;
  analysisId: string;
  scalp?: boolean;
  market: Awaited<ReturnType<typeof runMarketDataAgent>>;
  finalDecision: FinalDecisionResult;
  risk: RiskAgentResult;
  drawings: AgentFinalResult["drawings"];
  chartSnapshotHash: string;
}): Promise<ActiveRecommendation | null> {
  const rec = input.finalDecision.recommendation;
  if (
    rec.action !== "buy" &&
    rec.action !== "sell"
  ) {
    return null;
  }
  if (rec.entry == null || rec.stop_loss == null || !rec.targets?.length) {
    return null;
  }
  const candidate = input.risk.selectedCandidate;
  const id = newId();
  const createdCandleTime = input.market.currentTfCandles.at(-1)?.time;
  const active: ActiveRecommendation = {
    id,
    userId: input.userId,
    analysisId: input.analysisId,
    sessionId: input.sessionId,
    layoutId: input.layoutId,
    symbol: input.market.symbol,
    interval: input.market.interval,
    createdAt: createdCandleTime ?? Date.now(),
    createdCandleTime,
    // The agent states how many candles its plan stays meaningful; the
    // timeframe default remains the ceiling so a bad number cannot pin a plan
    // open for days.
    expiresAt: resolveValidity({
      validityCandles: rec.validityCandles ?? 6,
      interval: input.market.interval,
      maxExpiresAt: computeRecommendationExpiry({
        interval: input.market.interval,
        scalp: input.scalp,
        from: Date.now(),
      }),
      now: Date.now(),
    }).expiresAt,
    direction: rec.action,
    planType: rec.planType,
    entry: rec.entry,
    entryZone: rec.entryZone,
    entryType: rec.entryType,
    stopLoss: rec.stop_loss,
    targets: rec.targets,
    takeProfit: rec.take_profit ?? rec.targets[0],
    rr: rec.rr,
    status:
      rec.executionState === "valid_now" ||
      rec.activationClass === "immediate" ||
      rec.entryType === "market"
        ? "triggered"
        : "pending_entry",
    alternativeScenario: rec.alternativeScenario,
    validityCandles: rec.validityCandles,
    triggerCondition:
      rec.triggerCondition ?? `تتفعّل عند لمس منطقة الدخول حول ${rec.entry}.`,
    invalidationLevel: rec.stop_loss,
    invalidationRule:
      rec.invalidationRule ??
      (rec.action === "buy"
        ? `إغلاق شمعة تحت ${rec.stop_loss} يبطل السيناريو.`
        : `إغلاق شمعة فوق ${rec.stop_loss} يبطل السيناريو.`),
    setupType: input.scalp ? "scalp" : candidate?.setupType,
    poi: candidate
      ? {
          type: candidate.poi.type,
          low: candidate.poi.low,
          high: candidate.poi.high,
          score: candidate.poi.score.score,
          grade: candidate.poi.score.grade,
        }
      : undefined,
    summary: input.finalDecision.summary,
    keyReasons: input.finalDecision.keyReasons,
    riskWarnings: input.finalDecision.riskWarnings,
    publicReasoningSummary: input.finalDecision.publicReasoningSummary,
    drawings: input.drawings,
    chartSnapshotHash: input.chartSnapshotHash,
    priceAtCreation: input.market.currentPrice ?? undefined,
  };
  await rememberActiveRecommendation(active);
  // Persist a server-side tracked record (monitoring only — never executes).
  // Best-effort: a storage failure must not break the agent's reply.
  if (input.userId != null) {
    await persistTrackedRecommendation(active, input.userId, input.sessionId).catch(
      () => {},
    );
  }
  return active;
}

/** Map the in-memory recommendation to a persisted tracker record. */
async function persistTrackedRecommendation(
  active: ActiveRecommendation,
  userId: number,
  chatId: string,
): Promise<void> {
  const entryType: "market" | "limit" | "pending" =
    active.entryType === "market"
      ? "market"
      : active.entryType?.includes("limit")
        ? "limit"
        : "pending";
  await createTrackedRecommendation({
    id: active.id,
    userId,
    chatId,
    analysisId: active.analysisId,
    symbol: active.symbol,
    interval: active.interval,
    direction: active.direction,
    entryType,
    entry: active.entry,
    stopLoss: active.stopLoss,
    targets: active.targets,
    invalidationLevel: active.invalidationLevel,
    status:
      active.status === "triggered" || entryType === "market"
        ? "triggered"
        : "pending_entry",
    outcome: "pending",
    setupType: active.setupType,
    rr: active.rr,
    createdAt: Date.now(),
    createdCandleTime: active.createdCandleTime ?? active.createdAt,
    expiresAt: active.expiresAt ?? Date.now() + 4 * 60 * 60 * 1000,
    triggeredAt: entryType === "market" ? Date.now() : undefined,
    priceAtCreation: active.priceAtCreation,
  });
}
