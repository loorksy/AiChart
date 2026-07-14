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
import type { TradingStyle } from "@/lib/types";
import type { AppLocale } from "@/lib/i18n";
import type { AgentConversationContext } from "./context";
import { contextualizeIntentMessage } from "./context";
import { newId } from "./activity";
import {
  isGeneralOnly,
  isDrawingOnly,
  isDrawActiveRecommendation,
  isScalpRecommendation,
  isUserDrawingEdit,
  needsMarketContext,
  routeIntent,
} from "./intentRouter";
import { handleUserDrawingCommand } from "./drawingCommands/handleUserDrawingCommand";
import { withTimeout, AGENT_TIMEOUTS } from "./timeout";
import { buildInformationalResult, buildAgentFallbackResult } from "./fallback";
import { answerGeneralQuestion } from "./generalAnswer";
import { FEATURES } from "./featureFlags";
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
import { runFinalDecisionAgent } from "./agents/finalDecisionAgent";
import { runFinalDecisionSynthesizer } from "./agents/finalDecisionSynthesizer";
import { runDrawingAgent } from "./agents/drawingAgent";
import {
  buildDrawingPlan,
  buildDrawingCandidates,
} from "./drawings/buildDrawingPlan";
import { buildMarketNarrative } from "./marketContext/buildMarketNarrative";
import { runExecutionGuardAgent } from "./agents/executionGuardAgent";
import {
  effectiveMinRr,
  type UserTradingProfile,
} from "./risk/userTradingProfile";
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
import { contextualOptionsFor } from "./contextualOptions";
import { answerChartDrawingQuestion } from "./chartDrawingAnswer";
import { candleFreshnessToleranceMs } from "@/lib/markets/intervals";
import { createTrackedRecommendation } from "@/lib/recommendations/recommendationStore";

export interface UnifiedAgentInput {
  userMessage: string;
  chartContext?: AgentChartContext;
  requestContext: AgentRunContext;
  profile?: UserTradingProfile | null;
  account?: AccountRiskSnapshot | null;
  canExecute?: boolean;
  spread?: number | null;
  tradingStyle?: TradingStyle;
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
    (intents.includes("new_trade_analysis") ||
      intents.includes("scalp_recommendation"));

  if (intents.includes("cancel_active_recommendation")) {
    await clearActiveRecommendation(sessionId, chartContext?.symbol, ctx.userId);
    // The old recommendation is now terminal — drop it so the no-flip-flop
    // guard cannot block the fresh analysis the user explicitly asked for.
    activeRecommendation = null;
    if (!wantsReanalyzeAfterCancel) {
      return {
        decision: "informational",
        confidence: 0.9,
        summary: "ألغيت التوصية النشطة في هذه الجلسة. إذا أردت تحليلًا جديدًا اطلبه صراحة.",
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
    return drawStoredRecommendation(activeRecommendation, collected, locale);
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
  // OWN manual drawing, not the agent's Lonora drawings.
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
      "تعذّر شرح الرسومات في الوقت المتاح.",
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
      "تعذّر إكمال الإجابة في الوقت المتاح.",
    );
    return buildInformationalResult(summary, collected);
  }

  const wantMarket = needsMarketContext(intents);
  const educationalOnly = Boolean(ctx.session?.preferences.educationalOnly);
  const minRr = effectiveMinRr(input.profile ?? null, input.tradingStyle);

  // News-only path (news requested but no chart context needed).
  if (!wantMarket && intents.includes("market_news")) {
    const news = await withTimeout(
      runNewsMacroAgent(trackedCtx, { symbol: chartContext?.symbol, message: userMessage }),
      AGENT_TIMEOUTS.news,
      null,
    );
    const level = news?.newsRisk ?? "unknown";
    const unknownNews = level === "unknown";
    return {
      decision: "informational",
      confidence: level === "high" ? 0.6 : unknownNews ? 0.5 : 0.75,
      summary: unknownNews
        ? "خطر الأخبار غير معروف لأن مزوّد الأخبار غير مفعّل، لا يمكن تأكيد خطر الأخبار حالياً."
        : news?.reason
          ? `مراجعة الأخبار: ${news.reason}`
          : "تمت مراجعة الأخبار.",
      keyReasons: [],
      riskWarnings: level === "high" ? ["خطر إخباري مرتفع قريب."] : [],
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
      "تعذّر إكمال الإجابة في الوقت المتاح.",
    );
    return buildInformationalResult(summary, collected);
  }

  // --- Market fleet ---
  // Market Data Agent is CRITICAL: failure → stop, return action_required.
  const market = await withTimeout(
    runMarketDataAgent(trackedCtx, {
      ...chartContext,
      spread: input.spread,
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
      summary:
        "تعذّر تجهيز بيانات السوق من المخزن/OANDA. حاول مرة أخرى بعد قليل.",
      keyReasons: ["Market data unavailable."],
      riskWarnings: ["لم تصدر توصية بسبب نقص البيانات."],
      activityEvents: collected,
      recommendation: { action: "wait" },
      analysisId,
    };
  }

  if (!market.sync.ok) {
    return {
      decision: "action_required",
      confidence: 0,
      summary:
        "بيانات الوكيل غير متزامنة مع الشارت الحالي، لذلك لن أعطي توصية شراء/بيع ولن أرسم صفقة الآن. حدّث الشارت أو انتظر اكتمال مزامنة الشموع ثم أعد التحليل.",
      keyReasons: [market.sync.reason],
      riskWarnings: ["تم حظر التوصية لأن آخر شمعة/سعر لا يطابق الشارت الحالي."],
      activityEvents: collected,
      recommendation: { action: "wait" },
      analysisId,
      debugDecisionFlow:
        process.env.NODE_ENV === "development"
          ? {
              usedLLM: false,
              usedDeterministicFallback: true,
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
  const news = FEATURES.newsMacroAgent()
    ? await withTimeout(
        runNewsMacroAgent(trackedCtx, {
          symbol: market.symbol,
          message: userMessage,
        }).catch(() => null),
        AGENT_TIMEOUTS.news,
        null,
      )
    : null;

  // Risk is critical for a trade decision: failure → WAIT.
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
        profile: input.profile ?? null,
        account: input.account ?? null,
        minRr,
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

  // Deterministic baseline first — it computes the trade skeleton, risk veto,
  // and numeric levels, and is the safety fallback if the LLM fails.
  const deterministic = await withTimeout(
    runFinalDecisionAgent(trackedCtx, decisionInput),
    AGENT_TIMEOUTS.finalDecision,
    null,
  );
  if (!deterministic) {
    return buildAgentFallbackResult(
      "Final decision agent timed out — defaulting to WAIT.",
      collected,
    );
  }

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

  // LLM synthesizer: context-specific wording + candidate selection + drawing
  // advice. Hard rules (risk veto, no invented trades) are clamped inside it;
  // any failure falls back to the deterministic result.
  const synth = (await withTimeout(
    runFinalDecisionSynthesizer(trackedCtx, {
      ...decisionInput,
      deterministic,
      candidates,
      narrative,
    }).catch(() => null),
    AGENT_TIMEOUTS.finalDecision,
    null,
  )) ?? { result: deterministic, usedLLM: false };
  const finalDecision = synth.result;
  const chartSnapshotHash = hashMarketSnapshot(market, chartContext?.visibleRange);

  // Scalp mode is stricter: it demands a live session and fresh current-TF data.
  // Anything less resolves to WAIT (a bad scalp is worse than no scalp).
  if (
    isScalpRecommendation(intents) &&
    (finalDecision.decision === "buy" || finalDecision.decision === "sell") &&
    (!market.freshness.isFresh || !market.marketOpen)
  ) {
    return {
      decision: "action_required",
      confidence: 0,
      summary: !market.marketOpen
        ? "لا أعطي توصية سكالب والسوق خارج جلسة نشطة. السكالب يحتاج سيولة وحركة سعرية حية."
        : "لا أعطي توصية سكالب لأن بيانات الفريم الحالي ليست حديثة بما يكفي للسكالب. حدّث الشارت ثم أعد الطلب.",
      keyReasons: [
        !market.marketOpen
          ? "السوق مغلق/هادئ — شروط السكالب غير متوفرة."
          : "شموع الفريم الحالي متأخرة — دقة الدخول السريع غير مضمونة.",
      ],
      riskWarnings: ["تم حظر السكالب بسبب شروط الجلسة/الحداثة الصارمة."],
      recommendation: { action: "wait" },
      activityEvents: collected,
      analysisId,
      options: contextualOptionsFor({ decision: "informational", noActiveRecommendation: true, locale }),
    };
  }

  // HTF / daily freshness gate: a Buy/Sell decision leans on higher-timeframe
  // context, so it must not be issued on stale HTF data. Daily is only required
  // when daily confluence was actually available to the decision (mtf ran).
  if (finalDecision.decision === "buy" || finalDecision.decision === "sell") {
    const htfStale = isTimeframeStale(
      market.higherTfCandles.at(-1)?.time ?? null,
      market.higherInterval,
      market.marketOpen,
    );
    const dailyConfluenceUsed = Boolean(mtf);
    const dailyStale =
      dailyConfluenceUsed &&
      isTimeframeStale(
        market.dailyCandles.at(-1)?.time ?? null,
        "1d",
        market.marketOpen,
      );
    if (htfStale || dailyStale) {
      const which = htfStale ? `الفريم الأعلى (${market.higherInterval})` : "الفريم اليومي";
      return {
        decision: "action_required",
        confidence: 0,
        summary:
          `لن أعطي توصية ${recommendationDirectionAr(finalDecision.decision)} لأن بيانات ${which} غير محدّثة بما يكفي لقرار تداول موثوق. حدّث البيانات أو انتظر اكتمال شموع الفريم الأعلى ثم أعد التحليل.`,
        keyReasons: [
          htfStale
            ? `شموع ${market.higherInterval} متأخرة عن الزمن الحالي.`
            : "الشموع اليومية متأخرة بينما تعتمد التوصية على تأكيد يومي.",
        ],
        riskWarnings: ["تم حظر التوصية بسبب تقادم بيانات الفريم الأعلى/اليومي."],
        recommendation: { action: "wait" },
        activityEvents: collected,
        analysisId,
      };
    }
  }

  if (
    isActiveRecommendationLive(activeRecommendation) &&
    activeRecommendation.symbol.toUpperCase() === market.symbol.toUpperCase() &&
    (finalDecision.decision === "buy" || finalDecision.decision === "sell") &&
    finalDecision.decision !== activeRecommendation.direction
  ) {
    return {
      decision: "action_required",
      confidence: finalDecision.confidence,
      summary:
        `التوصية الحالية ${recommendationDirectionAr(activeRecommendation.direction)} على ${activeRecommendation.symbol} ولم تُلغَ أو تُبطَل بعد. لا أعطي توصية ${recommendationDirectionAr(finalDecision.decision)} معاكسة حتى تُلغى السابقة أو يكسر السعر مستوى الإبطال.`,
      keyReasons: [
        `التوصية النشطة: ${recommendationDirectionAr(activeRecommendation.direction)} من ${activeRecommendation.entry}.`,
        `الإبطال: ${activeRecommendation.invalidationRule}.`,
      ],
      riskWarnings: ["تم منع الانقلاب بين شراء/بيع على نفس الشارت بدون إبطال واضح."],
      recommendation: { action: "wait" },
      activityEvents: collected,
      analysisId,
      activeRecommendation: {
        id: activeRecommendation.id,
        status: activeRecommendation.status,
        direction: activeRecommendation.direction,
        symbol: activeRecommendation.symbol,
        interval: activeRecommendation.interval,
      },
    };
  }

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
          usedDeterministicFallback: !synth.usedLLM,
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
    FEATURES.executionGuard() &&
    (intents.includes("trade_execution") || intents.includes("trade_management"))
  ) {
    const guard = await withTimeout(
      runExecutionGuardAgent(trackedCtx, {
        market,
        finalDecision,
        risk,
        news,
        profile: input.profile ?? null,
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
        summary: "تعذّر التحقق من شروط التنفيذ — لن يُنفّذ شيء دون تأكيد.",
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
      scalp: isScalpRecommendation(intents),
      market,
      finalDecision,
      risk,
      drawings,
      chartSnapshotHash,
    });
  }

  return {
    decision: finalDecision.decision,
    confidence: finalDecision.confidence,
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

function noStoredRecommendation(
  collected: AgentFinalResult["activityEvents"],
  locale: AppLocale = "ar",
): AgentFinalResult {
  return {
    decision: "informational",
    confidence: 0.75,
    summary:
      "لا توجد توصية محفوظة في هذه الجلسة حاليًا. اطلب تحليلًا جديدًا أو أرسل التوصية التي تريد مراجعتها.",
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
function drawStoredRecommendation(
  rec: ActiveRecommendation | null,
  collected: AgentFinalResult["activityEvents"],
  locale: AppLocale = "ar",
): AgentFinalResult {
  if (!isActiveRecommendationLive(rec)) {
    return {
      decision: "informational",
      confidence: 0.7,
      summary:
        "لا توجد توصية نشطة لأرسم تفاصيلها. اطلب تحليلًا جديدًا أو توصية أولًا، ثم يمكنني رسم الدخول والوقف والأهداف.",
      keyReasons: [],
      riskWarnings: [],
      activityEvents: collected,
      options: contextualOptionsFor({ decision: "informational", noActiveRecommendation: true, locale }),
    };
  }
  const drawings = rec.drawings ?? [];
  return {
    decision: "informational",
    confidence: 0.85,
    summary: drawings.length
      ? `رسمت تفاصيل التوصية النشطة (${recommendationDirectionAr(rec.direction)} على ${rec.symbol}): الدخول والوقف والأهداف ومنطقة الإبطال. لم أُنشئ توصية جديدة.`
      : "التوصية النشطة موجودة لكن لا توجد رسومات محفوظة لها لإعادة عرضها.",
    keyReasons: [
      `التوصية: ${recommendationDirectionAr(rec.direction)} من ${rec.entry}.`,
      `الوقف: ${rec.stopLoss} — الأهداف: ${rec.targets.join(", ")}.`,
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
  if (!rec) return noStoredRecommendation(collected, locale);
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
  if (!rec) return noStoredRecommendation(collected, locale);

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
      summary:
        "لا أستطيع تحديث حالة التوصية لأن بيانات الوكيل غير متزامنة مع الشارت الحالي.",
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
  finalDecision: Awaited<ReturnType<typeof runFinalDecisionAgent>>;
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
    status: "pending_entry",
    triggerCondition:
      rec.action === "buy"
        ? `تتفعّل عند لمس منطقة الدخول حول ${rec.entry}.`
        : `تتفعّل عند لمس منطقة الدخول حول ${rec.entry}.`,
    invalidationLevel: rec.stop_loss,
    invalidationRule:
      rec.action === "buy"
        ? `إغلاق شمعة تحت ${rec.stop_loss} يبطل السيناريو.`
        : `إغلاق شمعة فوق ${rec.stop_loss} يبطل السيناريو.`,
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
    status: entryType === "market" ? "triggered" : "pending_entry",
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
