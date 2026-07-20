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
import { withTimeout, AGENT_TIMEOUTS } from "./timeout";
import { buildInformationalResult, buildAgentFallbackResult } from "./fallback";
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
  buildAgentSkillContext,
  EMPTY_SKILL_CONTEXT,
  type AgentSkillContext,
} from "./skills/skillContext";
import { bilingual, composeStatusReply } from "./statusReply";
import { contextualOptionsFor } from "./contextualOptions";
import { answerChartDrawingQuestion } from "./chartDrawingAnswer";
import { candleFreshnessToleranceMs } from "@/lib/markets/intervals";
import { createTrackedRecommendation } from "@/lib/recommendations/recommendationStore";

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
      bilingual(locale, "تعذّر شرح الرسومات في الوقت المتاح.", "Could not explain the drawings in time."),
    );
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
      bilingual(locale, "تعذّر إكمال الإجابة في الوقت المتاح.", "Could not complete the answer in time."),
    );
    return buildInformationalResult(summary, collected);
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
      bilingual(locale, "تعذّر إكمال الإجابة في الوقت المتاح.", "Could not complete the answer in time."),
    );
    return buildInformationalResult(summary, collected);
  }

  // --- Market fleet ---
  // Market Data Agent is CRITICAL: failure → stop, return action_required.
  const market = await withTimeout(
    runMarketDataAgent(trackedCtx, {
      ...chartContext,
      spread: input.spread,
      analysisKind,
    }).catch(() => null),
    AGENT_TIMEOUTS.marketData,
    null,
  );

  if (!market || market.currentPrice == null) {
    trackedCtx.emitActivity({
      type: "data",
      status: "failed",
      message: "تعذّر تجهيز بيانات السوق — لا يمكن إكمال تحليل الشارت الآن.",
    });
    return {
      decision: "action_required",
      confidence: 0,
      summary: bilingual(
        locale,
        "تعذّر تجهيز بيانات السوق من المخزن/OANDA. حاول مرة أخرى بعد قليل.",
        "Could not prepare market data from the warehouse/OANDA. Try again shortly.",
      ),
      keyReasons: ["Market data unavailable."],
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

  // Structure / liquidity / S&D / MTF run concurrently; each degrades to null.
  const [structure, liquidity, supplyDemand, mtf] = await Promise.all([
    withTimeout(runStructureAgent(trackedCtx, market).catch(() => null), AGENT_TIMEOUTS.structure, null),
    withTimeout(runLiquidityAgent(trackedCtx, market).catch(() => null), AGENT_TIMEOUTS.liquidity, null),
    withTimeout(runSupplyDemandAgent(trackedCtx, market).catch(() => null), AGENT_TIMEOUTS.supplyDemand, null),
    withTimeout(runMultiTimeframeAgent(trackedCtx, market).catch(() => null), AGENT_TIMEOUTS.multiTimeframe, null),
  ]);

  // News is non-critical: failure → newsRisk unknown (handled inside agent).
  const news = await withTimeout(
    runNewsMacroAgent(trackedCtx, {
      symbol: market.symbol,
      message: userMessage,
    }).catch(() => null),
    AGENT_TIMEOUTS.news,
    null,
  );

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
  } catch {
    risk = null;
  }
  if (!risk) {
    trackedCtx.emitActivity({
      type: "risk",
      status: "failed",
      message: "تعذّر إكمال فحص المخاطر — القرار انتظار احترازياً.",
    });
    return buildAgentFallbackResult(
      "Risk agent failed — defaulting to WAIT.",
      collected,
      locale,
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

  // Evidence-based chart story for the synthesizer (real detector output only).
  const narrative = buildMarketNarrative({ market, structure, liquidity, mtf });

  // The LLM chooses BUY, SELL, or WAIT and binds actionable choices to a real
  // candidate. Model failure produces a technical no-recommendation state.
  let synthError: unknown = null;
  const synth = await withTimeout(
    runFinalDecisionSynthesizer(trackedCtx, {
      ...decisionInput,
      candidates,
      narrative,
      locale,
      skillContextBlock: skillContext.block || null,
    }).catch((err) => {
      synthError = err;
      return null;
    }),
    AGENT_TIMEOUTS.finalDecision,
    null,
  );
  if (!synth) {
    return buildAgentFallbackResult(
      synthError
        ? "Decision model was unavailable — no market recommendation was issued."
        : "Decision model timed out — no market recommendation was issued.",
      collected,
      locale,
    );
  }
  if (!synth.usedLLM || !synth.result) {
    return buildAgentFallbackResult(
      "Decision model was unavailable — no market recommendation was issued.",
      collected,
      locale,
    );
  }
  const finalDecision = synth.result;
  const chartSnapshotHash = hashMarketSnapshot(market, chartContext?.visibleRange);

  // Build the drawing plan: the single source of truth for what may be drawn.
  // Weak fractals, thin data, and directionless WAITs all resolve to no drawing.
  const drawingPlan = buildDrawingPlan({
    decision: finalDecision,
    market,
    structure,
    supplyDemand,
    liquidity,
    mtf,
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
    }).catch(() => [] as AgentFinalResult["drawings"]),
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
      runExecutionGuardAgent(trackedCtx, {
        market,
        finalDecision,
        news,
        canExecute: Boolean(input.canExecute),
      }).catch(() => null),
      AGENT_TIMEOUTS.risk,
      null,
    );
    if (!guard) {
      // Guard failure → block execution (safe default).
      return {
        decision: "action_required",
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

  return {
    decision: finalDecision.decision,
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
    expiresAt: computeRecommendationExpiry({
      interval: input.market.interval,
      scalp: input.scalp,
      from: Date.now(),
    }),
    direction: rec.action,
    entry: rec.entry,
    entryType: rec.entryType,
    stopLoss: rec.stop_loss,
    targets: rec.targets,
    takeProfit: rec.take_profit ?? rec.targets[0],
    rr: rec.rr,
    status:
      rec.activationClass === "immediate" || rec.entryType === "market"
        ? "triggered"
        : "pending_entry",
    triggerCondition:
      rec.triggerCondition ??
      (rec.action === "buy"
        ? `تتفعّل عند لمس منطقة الدخول حول ${rec.entry}.`
        : `تتفعّل عند لمس منطقة الدخول حول ${rec.entry}.`),
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
