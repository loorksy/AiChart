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
import { newId } from "./activity";
import {
  isGeneralOnly,
  needsMarketContext,
  routeIntent,
} from "./intentRouter";
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
import { runDrawingAgent } from "./agents/drawingAgent";
import { runExecutionGuardAgent } from "./agents/executionGuardAgent";
import {
  effectiveMinRr,
  type UserTradingProfile,
} from "./risk/userTradingProfile";

export interface UnifiedAgentInput {
  userMessage: string;
  chartContext?: AgentChartContext;
  requestContext: AgentRunContext;
  profile?: UserTradingProfile | null;
  account?: AccountRiskSnapshot | null;
  canExecute?: boolean;
  spread?: number | null;
  tradingStyle?: TradingStyle;
}

export async function runUnifiedChartAgent(
  input: UnifiedAgentInput,
): Promise<AgentFinalResult> {
  const { userMessage, chartContext, requestContext: ctx } = input;
  const analysisId = newId();
  // The caller (SSE route / MCP wrapper) accumulates the emitted events and
  // merges them into the final payload — the orchestrator returns [] here.
  const collected: AgentFinalResult["activityEvents"] = [];
  const trackedCtx = ctx;

  const intents = routeIntent({
    message: userMessage,
    chartContext,
    ctx: trackedCtx,
  });

  // General-only → answer with no market agents (cost control).
  if (isGeneralOnly(intents)) {
    trackedCtx.emitActivity({
      type: "analysis",
      status: "started",
      message: "أجهّز إجابة عامة دون تشغيل وكلاء التداول.",
    });
    const summary = await withTimeout(
      answerGeneralQuestion(userMessage),
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
    return {
      decision: "informational",
      confidence: level === "high" ? 0.6 : 0.75,
      summary: news?.reason
        ? `مراجعة الأخبار: ${news.reason}`
        : "تمت مراجعة الأخبار.",
      keyReasons: [],
      riskWarnings: level === "high" ? ["خطر إخباري مرتفع قريب."] : [],
      activityEvents: collected,
      newsRisk: news ? { level, reason: news.reason } : undefined,
    };
  }

  if (!wantMarket) {
    // Account-only or platform-help without market context.
    const summary = await withTimeout(
      answerGeneralQuestion(userMessage),
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

  const finalDecision = await withTimeout(
    runFinalDecisionAgent(trackedCtx, { userMessage, risk, news }),
    AGENT_TIMEOUTS.finalDecision,
    null,
  );
  if (!finalDecision) {
    return buildAgentFallbackResult(
      "Final decision agent timed out — defaulting to WAIT.",
      collected,
    );
  }

  // Drawings are non-critical: failure → return text result without drawings.
  let drawings = await withTimeout(
    runDrawingAgent(trackedCtx, {
      analysisId,
      market,
      finalDecision,
      structure,
      supplyDemand,
    }).catch(() => [] as AgentFinalResult["drawings"]),
    AGENT_TIMEOUTS.drawing,
    [] as AgentFinalResult["drawings"],
  );
  drawings = drawings ?? [];

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

  return {
    decision: finalDecision.decision,
    confidence: finalDecision.confidence,
    summary: finalDecision.summary,
    keyReasons: finalDecision.keyReasons,
    riskWarnings: finalDecision.riskWarnings,
    recommendation: finalDecision.recommendation,
    drawings,
    newsRisk: news ? { level: news.newsRisk, reason: news.reason } : undefined,
    activityEvents: collected,
    analysisId,
  };
}
