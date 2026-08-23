/**
 * The web chat turn — the ONE pipeline behind /api/agent/chat/stream,
 * extracted so it can run in either process (Work B, design A2):
 *
 *  - no REDIS_URL (dev): the route invokes it inline inside its
 *    ReadableStream, emit = SSE frames, exactly the pre-queue behavior;
 *  - REDIS_URL set (production): the resident worker invokes it and emit
 *    writes the per-turn relay stream — which moves usage metering and the
 *    balance commit into the worker, with the SAME idempotent keys: the
 *    debit ref stays `chat:<requestId>` and the ledger's UNIQUE
 *    (user_id, kind, ref) stays the guarantee, never a code check.
 *
 * Event names and payloads are the SSE contract and do not change here.
 * The transport (heartbeats, stream close, burst slot) stays with the
 * caller; this module owns everything between the billing gates and the
 * final event: context, the orchestrator run, trace, audit, suggestions,
 * trial commit/release, the chat debit, and history persistence.
 */
import { z } from "zod";
import { getLimits, getSettings } from "@/lib/store";
import { resolveUserModelSelection, withRequestModel } from "@/lib/llm";
import { withUsageContext } from "@/lib/billing/usageMeter";
import { authorizeAndDebit } from "@/lib/billing/spend";
import { t } from "@/lib/i18n";
import { FEATURES, featureFlagSnapshot } from "@/lib/agent/featureFlags";
import {
  commitTrialInteraction,
  releaseTrialInteraction,
} from "@/lib/subscription/trialQuota";
import {
  createActivityEvent,
  shouldShowActivity,
} from "@/lib/agent/activity";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import {
  updateSessionFromMessage,
  rememberContext,
} from "@/lib/agent/sessionMemory";
import {
  resolveOptionReply,
  rememberOptions,
  clearOptions,
} from "@/lib/agent/sessionOptions";
import { routeIntent } from "@/lib/agent/intentRouter";
import { generateAgentSuggestions } from "@/lib/agent/suggestions/generateAgentSuggestions";
import { createLogger } from "@/lib/logger";
import { recordRequestWithoutFinal } from "@/lib/metrics";
import { writeAgentAudit } from "@/lib/agent/auditLog";
import { buildAgentFallbackResult } from "@/lib/agent/fallback";
import { classifyAgentError, userMessageForFailure } from "@/lib/agent/errorTaxonomy";
import type { AgentActivityEvent, AgentFinalResult } from "@/lib/agent/types";
import { unfinishedStages, type AgentStageEvent } from "@/lib/agent/stageEvents";
import { recallAgentMemoryForContext } from "@/lib/agent/agentMemory";
import { canonicalIdentity, canonicalIdentityHash } from "@/lib/agent/canonicalIdentity";
import { addAgentRunStep, finalizeAgentRun, startAgentRun } from "@/lib/agent/runTrace";
import { appendMessage } from "@/lib/agent/chatHistory/chatStore";
import { refreshChatMetaAfterAssistantTurn } from "@/lib/agent/chatHistory/refreshChatMeta";
import { stripInternalFieldsFromClientResult } from "@/lib/agent/userSafeOutbound";
import {
  type AgentConversationContext,
  type SafeRecommendationContext,
  resolveActiveRecommendationContext,
} from "@/lib/agent/context";
import {
  bindChannel,
  buildSessionConversationContext,
  maybeSummarizeResidentSession,
} from "@/lib/resident/sessions";
import type { PublicUser } from "@/lib/types";

const log = createLogger("agent.chat.stream");

const drawingTypes = [
  "price_line",
  "trend_line",
  "forecast_path",
  "channel",
  "zone",
  "fib_retracement",
  "baseline",
  "marker",
  "histogram_band",
  "polyline_pattern",
  "risk_reward_box",
  "neckline",
  "breakout_arrow",
  "retest_zone",
  "pattern_label",
  "range_box",
  "supply_zone",
  "demand_zone",
  "decision_zone",
  "labeled_arrow",
  "long_position",
  "short_position",
  "parallel_channel",
  "regression_trend",
  "hline",
  "vline",
  "trend",
  "trendline",
  "ray",
  "rectangle",
  "triangle",
  "ellipse",
  "arrow_down",
  "arrow_sell",
  "arrow_up",
  "arrow_buy",
  "arrow_stop",
  "arrow_check",
  "arrow_thumb_up",
  "arrow_thumb_down",
  "arrow",
  "fibo",
  "fibonacci",
  "fibo_fan",
  "fibo_arc",
  "expansion",
  "pitchfork",
  "gann_line",
  "gann_fan",
  "text",
  "label",
] as const;

const semanticRoles = [
  "support",
  "resistance",
  "demand_zone",
  "supply_zone",
  "range",
  "trendline",
  "channel",
  "neckline",
  "breakout",
  "retest",
  "entry",
  "stop_loss",
  "take_profit",
  "risk_reward",
  "pattern",
  "forecast",
  "liquidity_sweep",
  "decision_zone",
] as const;

const patternTypes = [
  "double_bottom",
  "double_top",
  "w_pattern",
  "m_pattern",
  "head_and_shoulders",
  "inverse_head_and_shoulders",
  "ascending_triangle",
  "descending_triangle",
  "symmetrical_triangle",
  "cup_and_handle",
  "flag",
  "pennant",
  "wedge",
  "channel",
  "range",
] as const;

const chartPointSchema = z
  .object({
    price: z.number(),
    time: z.number().optional(),
    barsAhead: z.number().optional(),
    time_offset: z.number().optional(),
  })
  .passthrough();

const chartDrawingSchema = z
  .object({
    type: z.enum(drawingTypes),
    confidence: z.number().default(0.75),
    label: z.string().max(160).optional(),
    color: z.string().max(40).optional(),
    points: z.array(chartPointSchema).max(12).default([]),
    semanticRole: z.enum(semanticRoles).optional(),
    patternType: z.enum(patternTypes).optional(),
    drawingPurpose: z.string().max(240).optional(),
    price: z.number().optional(),
    price2: z.number().optional(),
    price3: z.number().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// Safe, bounded transport for user-created drawings read from the chart. Mirrors
// DRAWING_LIMITS (max 50 drawings, 8 points, label 200) and requires finite
// numeric prices/times — no raw TradingView objects ever cross this boundary.
const serializedDrawingPointSchema = z
  .object({
    time: z.number().finite().optional(),
    price: z.number().finite().positive().optional(),
  })
  .strip();

const serializedUserDrawingSchema = z
  .object({
    id: z.string().min(1).max(80),
    owner: z.enum(["user", "agent", "recommendation"]).default("user"),
    type: z.string().min(1).max(60),
    symbol: z.string().max(20).default(""),
    interval: z.string().max(8).default(""),
    points: z.array(serializedDrawingPointSchema).max(8).default([]),
    priceLevels: z.array(z.number().finite().positive()).max(8).optional(),
    label: z.string().max(200).optional(),
    color: z.string().max(40).optional(),
    lineStyle: z.string().max(20).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    createdAt: z.number().finite().optional(),
    updatedAt: z.number().finite().optional(),
    source: z.enum(["tradingview", "lonora"]).default("tradingview"),
  })
  .strip();

const chartRecommendationSchema = z
  .object({
    id: z.string().max(96).optional(),
    status: z.string().max(40).optional(),
    action: z.enum(["buy", "sell", "wait"]),
    entry: z.number().optional(),
    entryType: z
      .enum(["market", "buy_limit", "buy_stop", "sell_limit", "sell_stop"])
      .optional(),
    stop_loss: z.number().optional(),
    take_profit: z.number().optional(),
    targets: z.array(z.number()).max(5).optional(),
    rr: z.number().optional(),
  })
  .passthrough();

export const webChatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().min(1).max(64).optional(),
  chartContext: z
    .object({
      symbol: z.string().max(20).optional(),
      interval: z.string().max(8).optional(),
      layoutId: z.string().max(32).optional(),
      visibleRange: z
        .object({ from: z.number(), to: z.number() })
        .optional(),
      latestCandle: z
        .object({
          // symbol/interval let the Market Sync Guard reject chart drift.
          symbol: z.string().max(20).optional(),
          interval: z.string().max(8).optional(),
          time: z.number(),
          open: z.number().optional(),
          high: z.number().optional(),
          low: z.number().optional(),
          close: z.number(),
          volume: z.number().optional(),
        })
        .optional(),
      drawings: z.array(chartDrawingSchema).max(80).optional(),
      userDrawings: z.array(serializedUserDrawingSchema).max(50).optional(),
      selectedDrawingId: z.string().max(80).optional(),
      recommendation: chartRecommendationSchema.optional(),
      dataSource: z.enum(["oanda"]).optional(),
    })
    .optional(),
  locale: z.enum(["ar", "en"]).optional(),
});

export type WebChatBody = z.infer<typeof webChatBodySchema>;

/** Transport hook: SSE frames inline, XADD entries under the queue. */
export type WebTurnEmitter = (event: string, data: unknown) => void;

export interface WebTurnInput {
  user: Pick<PublicUser, "id" | "role" | "status">;
  body: WebChatBody;
  /** The turn id — audit trail, trace, and the debit ref all key off it. */
  requestId: string;
  /** Resolved by the caller (body.sessionId or a fresh id). */
  sessionId: string;
  /** Whether the route's trial claim metered this turn. */
  trialMetered: boolean;
  /**
   * The user's preferred_model_ref pinned at send time (queue path).
   * Undefined = read the current setting here (inline path).
   */
  modelRef?: string | null;
  /** Abort = user cancellation: no partial result, no error badge. */
  signal: AbortSignal;
  emit: WebTurnEmitter;
}

/** Injectable seams for tests — production always uses the real ones. */
export interface WebTurnDeps {
  runAgent?: typeof runUnifiedChartAgent;
  suggest?: typeof generateAgentSuggestions;
}

export interface WebTurnOutcome {
  sentFinal: boolean;
  aborted: boolean;
}

export async function runWebChatTurn(
  input: WebTurnInput,
  deps: WebTurnDeps = {},
): Promise<WebTurnOutcome> {
  const { user, body, requestId, sessionId, trialMetered, signal } = input;
  const runAgent = deps.runAgent ?? runUnifiedChartAgent;
  const suggest = deps.suggest ?? generateAgentSuggestions;

  const limits = await getLimits(user.id);
  const canExecute = limits.can_execute !== 0;

  // If the last assistant turn offered numbered options and the user replied
  // with a bare index, resolve it to that option's real prompt instead of
  // treating it as a new general question. This state is in-process, so it
  // lives HERE — the process where turns actually run — on both paths.
  const resolvedMessage =
    resolveOptionReply(sessionId, body.message) ?? body.message;

  // Fold any preference directives into session memory before the run.
  const session = updateSessionFromMessage(sessionId, resolvedMessage);
  const activityEvents: AgentActivityEvent[] = [];
  let conversationContext: AgentConversationContext | undefined;
  if (FEATURES.agentContextV2()) {
    try {
      // channel !== session: the web thread binds into the USER's one
      // session, so context includes turns from every channel (Telegram
      // included) plus the rolling cross-channel summary.
      await bindChannel("web", String(user.id), user.id);
      const recalled = await recallAgentMemoryForContext({
        userId: user.id,
        query: resolvedMessage,
        symbol: body.chartContext?.symbol,
        timeframe: body.chartContext?.interval,
        locale: body.locale ?? "ar",
        memoryLimit: 5,
        lessonLimit: 3,
      });
      conversationContext = await buildSessionConversationContext({
        userId: user.id,
        sessionId,
        userMessage: resolvedMessage,
        locale: body.locale ?? "ar",
        chartContext: body.chartContext,
        activeRecommendation: recommendationContextFromChart(body.chartContext),
        recalledMemories: recalled.memories,
        tradeLessons: recalled.tradeLessons,
        tokenBudget: 2_400,
        includeDiagnostics: process.env.NODE_ENV === "development",
      });
    } catch (error) {
      // Context V2 is an optional language aid. Failure must not block the
      // current route or weaken market/risk/execution controls.
      log.warn("agent.context_v2.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Phase-0 SLO instrumentation (item 9): every request must end with a
  // complete `final`. This flag is the ONLY source of that measurement.
  let sentFinal = false;
  const send = (event: string, data: unknown) => {
    if (event === "final") sentFinal = true;
    try {
      input.emit(event, data);
    } catch {
      /* client gone — keep working so audit + state persist */
    }
  };

  const emitActivity = (ev: Omit<AgentActivityEvent, "id" | "timestamp">) => {
    const full = createActivityEvent(ev);
    // Only real, meaningful tool/agent work reaches the client. Internal
    // narration and scripted intent messages are suppressed.
    if (!shouldShowActivity(full)) return;
    activityEvents.push(full);
    send("activity", full);
  };

  // Run-stage protocol (Phase 3.1): the orchestrator narrates its own
  // fleet boundaries; this only forwards them and keeps the run's list
  // so the final result persists the checklist with the message.
  const stageEvents: AgentStageEvent[] = [];
  const emitStage = (ev: Omit<AgentStageEvent, "timestamp">) => {
    const full: AgentStageEvent = { ...ev, timestamp: Date.now() };
    stageEvents.push(full);
    send("stage", full);
  };

  // Live answer text (Phase 3.3, general answers): cumulative sanitized
  // text with REPLACE semantics — the final event remains authoritative.
  const emitAnswerText = (fullText: string) => {
    send("answer_text", { text: fullText });
  };

  // The pending bubble narrates itself from REAL work only: `stage` and
  // `activity` events emitted by the engine at the moment things happen.
  const previewIntents = routeIntent({
    message: resolvedMessage,
    chartContext: body.chartContext,
    ctx: { requestId, emitActivity: () => {} },
  });
  const traceRunId = FEATURES.agentRunTraceV1()
    ? await startAgentRun({
        userId: user.id,
        chatId: sessionId,
        sessionId,
        requestId,
        symbol: body.chartContext?.symbol,
        timeframe: body.chartContext?.interval,
        intents: previewIntents,
        featureFlags: {
          ...featureFlagSnapshot(),
          // Safe identity provenance: hash + source only, never content.
          [`prompt:${canonicalIdentityHash()}`]: canonicalIdentity().source === "file",
        },
        contextVersion: conversationContext ? "v2" : "legacy",
        contextMessageCount: conversationContext?.messages.length ?? 0,
        recalledMemoryCount: conversationContext?.recalledMemoryIds.length ?? 0,
      })
    : null;

  try {
    // The user's own model choice governs every LLM call in this run.
    // Under the queue the ref was pinned at send time; inline it is read
    // here. Either way an unset/unconfigured ref falls back to the default.
    const modelSelection = await resolveUserModelSelection(
      input.modelRef !== undefined
        ? input.modelRef
        : (await getSettings(user.id)).preferred_model_ref,
    );
    const result = await withUsageContext(
      { userId: user.id, kind: "chat" },
      () =>
        withRequestModel(modelSelection, () =>
          runAgent({
            userMessage: resolvedMessage,
            chartContext: body.chartContext,
            locale: body.locale,
            liveSession: true,
            requestContext: {
              requestId,
              userId: user.id,
              sessionId,
              emitActivity,
              emitStage,
              emitAnswerText,
              emitDebug: () => {},
              signal,
              session,
            },
            account: null,
            canExecute,
            conversationContext,
          }),
        ),
    );

    if (traceRunId) {
      await addAgentRunStep({
        userId: user.id,
        runId: traceRunId,
        type: "final_decision",
        status: "completed",
        summary: result.summary,
        evidence: {
          decision: result.decision,
          confidence: result.confidence,
          // Names/versions only — safe skill diagnostics, never content.
          selectedSkills: result.selectedSkills ?? [],
          skillLoadFailures: result.skillLoadFailures ?? [],
          // Full research transparency stays in runTrace only (not SSE).
          researchEvidence: result.researchEvidence ?? null,
          evidenceTimeline: result.evidenceTimeline ?? null,
          skillNames: (result.selectedSkills ?? []).map((s) => s.name),
        },
      });
      await finalizeAgentRun({
        userId: user.id,
        runId: traceRunId,
        status: "completed",
        decision: result.decision,
        confidence: result.confidence,
        skillNames: (result.selectedSkills ?? []).map((s) => s.name),
      });
    }

    rememberContext(sessionId, {
      symbol: body.chartContext?.symbol,
      interval: body.chartContext?.interval,
      analysisId: result.analysisId,
    });

    await writeAgentAudit({
      userId: user.id,
      requestId,
      sessionId,
      symbol: body.chartContext?.symbol,
      interval: body.chartContext?.interval,
      decision: result.decision,
      confidence: result.confidence,
      newsRisk: result.newsRisk?.level,
      executionRequiresConfirmation: result.requiresConfirmation,
      executionConfirmed: false,
      summary: result.summary,
      metadata: {
        sessionId,
        // Blocker diagnostics — without these, a Request ID resolved from
        // the DB said only "unexpected error" while the real cause lived
        // (briefly) in stdout. Codes only, never provider payloads.
        ...(result.envelope?.outcome_class === "operational_blocker"
          ? {
              outcome_class: result.envelope.outcome_class,
              failure_code: result.envelope.failure_code ?? null,
              failure_stage: result.envelope.failure_stage ?? null,
              retryable: result.envelope.retryable ?? null,
              // The provider's own words (e.g. "no credits remaining") —
              // the difference between a diagnosable Request ID and a
              // dead end once pm2 logs rotate.
              error_detail: result.operatorFailureDetail ?? null,
            }
          : {}),
        ...(result.envelope?.degraded_stages?.length
          ? { degraded_stages: result.envelope.degraded_stages }
          : {}),
      },
    });

    // Dynamic, model-generated follow-up suggestions for THIS turn/state.
    // No static fallback: a failure yields [] and the UI shows nothing.
    const suggestions = await suggest({
      locale: body.locale ?? "ar",
      userMessage: resolvedMessage,
      result,
      symbol: body.chartContext?.symbol,
      interval: body.chartContext?.interval,
      activeRecommendation: result.activeRecommendation,
      maxSuggestions: 4,
    }).catch(() => []);

    // Number-reply resolver targets the suggestions actually shown.
    if (suggestions.length) {
      rememberOptions(sessionId, suggestions);
    } else {
      clearOptions(sessionId);
    }

    if (trialMetered) {
      await commitTrialInteraction(user.id, requestId);
    }

    // Chat pricing (admin-set, 0 = free): charged only on a COMPLETED
    // turn — a failed run costs nothing. The upfront gate was the
    // refusal point; if a concurrent spend emptied the balance since,
    // the conditional debit refuses silently and the balance still
    // never goes below zero. ref = requestId, so the same turn can
    // never charge twice (queue redelivery included).
    await authorizeAndDebit({
      userId: user.id,
      op: "chat_turn",
      ref: `chat:${requestId}`,
    }).catch(() => {});

    const safeResult = stripInternalFieldsFromClientResult(result);
    // Persist even if the browser dropped — a reconnecting client
    // polls history and claims this turn instead of dying mid-run.
    await persistStreamAssistant(user.id, sessionId, safeResult, {
      symbol: body.chartContext?.symbol,
      interval: body.chartContext?.interval,
    });
    send("final", {
      ...safeResult,
      sessionId,
      activityEvents,
      // The run's stage checklist, persisted with the message so a
      // reopened chat still shows HOW the answer was produced.
      stages: stageEvents,
      // Replace static contextual options with the dynamic suggestions.
      options: suggestions,
      suggestions,
      debugDecisionFlow:
        process.env.NODE_ENV === "development"
          ? result.debugDecisionFlow
          : undefined,
    });
  } catch (error) {
    if (trialMetered) {
      await releaseTrialInteraction(user.id, requestId);
    }
    if (signal.aborted) {
      if (traceRunId) {
        await finalizeAgentRun({ userId: user.id, runId: traceRunId, status: "cancelled" });
      }
      // Cancelled by the user — no partial result, no error badge.
    } else {
      const classified = classifyAgentError(error);
      if (traceRunId) {
        await finalizeAgentRun({
          userId: user.id,
          runId: traceRunId,
          status: "failed",
          // The taxonomy code, not a constant — "AGENT_RUN_FAILED" told
          // a Request ID lookup nothing about what actually broke.
          errorCode: classified.code,
        });
      }
      // A thrown run previously wrote NO audit row at all, so the
      // Request ID shown to the operator resolved to nothing.
      await writeAgentAudit({
        userId: user.id,
        requestId,
        sessionId,
        symbol: body.chartContext?.symbol,
        interval: body.chartContext?.interval,
        decision: "informational",
        summary: userMessageForFailure(classified.code, body.locale ?? "ar", {
          stages: unfinishedStages(stageEvents),
          provider: classified.provider,
        }),
        metadata: {
          sessionId,
          outcome_class: "operational_blocker",
          failure_code: classified.code,
          failure_stage: "transport",
          retryable: classified.retryable,
          error_name: error instanceof Error ? error.name : typeof error,
          error_detail: classified.detail.slice(0, 500),
          ...(classified.provider ? { provider: classified.provider } : {}),
        },
      });
      const failed = createActivityEvent({
        type: "final",
        status: "failed",
        message: t(body.locale ?? "ar", "agent.run_failed"),
      });
      send("activity", failed);
      // Contract guarantee (phase-0 SLO): even a crashed run ends with a
      // COMPLETE `final` event carrying an operational_blocker envelope —
      // never only a bare `error` event.
      const fallbackResult = buildAgentFallbackResult(
        "Agent run failed before producing a result.",
        activityEvents,
        body.locale ?? "ar",
        {
          detail: userMessageForFailure(classified.code, body.locale ?? "ar", {
            provider: classified.provider,
          }),
          retryable: classified.retryable,
          failureStage: "transport",
          failureCode: classified.code,
          traceId: requestId,
          provider: classified.provider,
          // Name what actually stalled. The run already emitted a stage
          // event per step, so the stages left running or failed at the
          // moment it died ARE the cause — the operator should not have
          // to open a support ticket to learn which one.
          degradedStages: unfinishedStages(stageEvents),
        },
      );
      const safeFallback = stripInternalFieldsFromClientResult(fallbackResult);
      await persistStreamAssistant(user.id, sessionId, safeFallback, {
        symbol: body.chartContext?.symbol,
        interval: body.chartContext?.interval,
      });
      send("final", {
        ...safeFallback,
        sessionId,
        activityEvents,
        stages: stageEvents,
        options: [],
        suggestions: [],
      });
      // Legacy clients still listen for `error` — keep it, without
      // leaking the raw provider message to the operator.
      send("error", {
        error: userMessageForFailure(classified.code, body.locale ?? "ar", {
          stages: unfinishedStages(stageEvents),
          provider: classified.provider,
        }),
        code: classified.code,
        trace_id: requestId,
      });
      log.error("agent.stream.failed", {
        requestId,
        code: classified.code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    // SLO: a run that ended without a complete `final` is a contract
    // breach. A user cancellation is NOT a breach (nobody is waiting).
    if (!sentFinal && !signal.aborted) {
      recordRequestWithoutFinal("agent.chat.stream", "no_final_event");
      log.error("agent.stream.slo_breach", { requestId, reason: "no_final_event" });
    }
  }

  return { sentFinal, aborted: signal.aborted };
}

export async function persistStreamAssistant(
  userId: number,
  chatId: string,
  result: AgentFinalResult,
  refs: { symbol?: string; interval?: string },
): Promise<void> {
  try {
    await appendMessage(userId, chatId, {
      role: "assistant",
      content: result.summary,
      result,
      recommendationId: result.recommendationId ?? result.activeRecommendation?.id,
      analysisId: result.analysisId,
      symbol: refs.symbol,
      interval: refs.interval,
    });
    void refreshChatMetaAfterAssistantTurn(userId, chatId);
    // Fold older cross-channel turns into the rolling session summary once
    // they pile up — summarize, never truncate blindly. Best-effort.
    void maybeSummarizeResidentSession(userId).catch(() => {});
  } catch (error) {
    log.warn("agent.stream.persist_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function recommendationContextFromChart(
  chartContext: WebChatBody["chartContext"],
): SafeRecommendationContext | null {
  const recommendation = chartContext?.recommendation;
  if (!recommendation?.id || recommendation.action === "wait") return null;
  const candidate: SafeRecommendationContext = {
    id: recommendation.id,
    source: "chart",
    symbol: chartContext?.symbol ?? "",
    timeframe: chartContext?.interval ?? "",
    direction: recommendation.action,
    status: recommendation.status ?? "pending_entry",
    entry: recommendation.entry,
    stopLoss: recommendation.stop_loss,
    targets: recommendation.targets ?? (recommendation.take_profit ? [recommendation.take_profit] : []),
  };
  return resolveActiveRecommendationContext({
    candidates: [candidate],
    symbol: chartContext?.symbol,
    timeframe: chartContext?.interval,
  }) ?? null;
}
