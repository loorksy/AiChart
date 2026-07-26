import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getLimits } from "@/lib/store";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { sseEncode } from "@/lib/sse";
import { FEATURES, featureFlagSnapshot } from "@/lib/agent/featureFlags";
import {
  claimTrialInteraction,
  commitTrialInteraction,
  releaseTrialInteraction,
  subscriptionRequiredMessage,
} from "@/lib/subscription/trialQuota";
import {
  createActivityEvent,
  newId,
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
import { generateTickerPlan } from "@/lib/agent/ticker/generateTickerPlan";
import { streamTicker } from "@/lib/agent/ticker/streamTicker";
import { newsProviderConfigured } from "@/lib/agent/news/newsProvider";
import { createLogger } from "@/lib/logger";
import { recordRequestWithoutFinal } from "@/lib/metrics";
import { writeAgentAudit } from "@/lib/agent/auditLog";
import { buildAgentFallbackResult } from "@/lib/agent/fallback";
import { classifyAgentError, userMessageForFailure } from "@/lib/agent/errorTaxonomy";
import type { AgentActivityEvent } from "@/lib/agent/types";
import { recallAgentMemoryForContext } from "@/lib/agent/agentMemory";
import { canonicalIdentity, canonicalIdentityHash } from "@/lib/agent/canonicalIdentity";
import { addAgentRunStep, finalizeAgentRun, startAgentRun } from "@/lib/agent/runTrace";
import { getMessages } from "@/lib/agent/chatHistory/chatStore";
import { stripInternalFieldsFromClientResult } from "@/lib/agent/userSafeOutbound";
import {
  adaptAuthorizedChatHistory,
  buildAgentConversationContext,
  type AgentConversationContext,
  type SafeRecommendationContext,
  resolveActiveRecommendationContext,
} from "@/lib/agent/context";

export const runtime = "nodejs";
export const maxDuration = 180;

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

const schema = z.object({
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
      dataSource: z.enum(["oanda", "ea"]).optional(),
    })
    .optional(),
  locale: z.enum(["ar", "en"]).optional(),
});

export async function POST(req: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const user = await requirePlatformAccess();

    if (!(await isLLMConfiguredAsync())) {
      return NextResponse.json(
        { error: "الذكاء الاصطناعي غير مُفعّل على الخادم." },
        { status: 503 },
      );
    }

    const body = schema.parse(await req.json());
    const locale = body.locale ?? "ar";
    const requestId = newId();

    // Trial / subscription gate — blocks before any model-provider work.
    const trialClaim = await claimTrialInteraction(user, requestId);
    if (!trialClaim.ok) {
      return NextResponse.json(
        { error: subscriptionRequiredMessage(locale) },
        { status: 403 },
      );
    }
    const trialMetered = trialClaim.mode === "trial";

    // Burst guard: one heavy agent run per user + global cap (rate limiting).
    const slot = acquireAnalyzeSlot(user.id);
    if (!slot.ok) {
      if (trialMetered) await releaseTrialInteraction(user.id, requestId);
      const msg =
        slot.reason === "in_flight"
          ? "يوجد تحليل قيد التشغيل. انتظر قليلاً ثم حاول مرة أخرى."
          : "المنصة تحت ضغط مرتفع حالياً — أعد المحاولة خلال ثوانٍ.";
      return NextResponse.json(
        { error: msg },
        { status: slot.reason === "in_flight" ? 429 : 503 },
      );
    }
    release = slot.release;

    const limits = await getLimits(user.id);
    const canExecute = limits.can_execute !== 0;

    const sessionId = body.sessionId ?? newId();

    // If the last assistant turn offered numbered options and the user replied
    // with a bare index ("1" / "١"), resolve it to that option's real prompt
    // instead of treating it as a new general question.
    const resolvedMessage =
      resolveOptionReply(sessionId, body.message) ?? body.message;

    // Fold any preference directives into session memory before the run.
    const session = updateSessionFromMessage(sessionId, resolvedMessage);
    const activityEvents: AgentActivityEvent[] = [];
    let conversationContext: AgentConversationContext | undefined;
    if (FEATURES.agentContextV2()) {
      try {
        const [persisted, recalled] = await Promise.all([
          getMessages(user.id, sessionId, 160),
          recallAgentMemoryForContext({
            userId: user.id,
            query: resolvedMessage,
            symbol: body.chartContext?.symbol,
            timeframe: body.chartContext?.interval,
            locale: body.locale ?? "ar",
            memoryLimit: 5,
            lessonLimit: 3,
          }),
        ]);
        const adapted = adaptAuthorizedChatHistory({
          authenticatedUserId: user.id,
          ownerUserId: user.id,
          authorizedChatId: sessionId,
          messages: persisted,
        });
        conversationContext = buildAgentConversationContext({
          userId: user.id,
          chatId: sessionId,
          sessionId,
          userMessage: resolvedMessage,
          locale: body.locale ?? "ar",
          chartContext: body.chartContext,
          activeRecommendation: recommendationContextFromChart(body.chartContext),
          persistedMessages: adapted,
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

    const stream = new ReadableStream({
      async start(controller) {
        // Phase-0 SLO instrumentation (item 9): every request must end with a
        // complete `final`. This flag is the ONLY source of that measurement.
        let sentFinal = false;
        const send = (event: string, data: unknown) => {
          if (event === "final") sentFinal = true;
          try {
            controller.enqueue(sseEncode(event, data));
          } catch {
            /* client gone — keep working so audit + state persist */
          }
        };

        const emitActivity = (
          ev: Omit<AgentActivityEvent, "id" | "timestamp">,
        ) => {
          const full = createActivityEvent(ev);
          // Only real, meaningful tool/agent work reaches the client. Internal
          // narration and scripted intent messages are suppressed.
          if (!shouldShowActivity(full)) return;
          activityEvents.push(full);
          send("activity", full);
        };

        // --- Live thinking ticker (UI-only, model-generated per run). ---
        // Runs CONCURRENTLY with the agent: the final answer never waits for
        // ticker generation, and if generation fails the ticker is simply
        // hidden — there is NO static fallback text, ever.
        let done = false;
        const tickerDebug: {
          tickerGenerated: boolean;
          tickerHiddenReason?: string;
        } = { tickerGenerated: false };
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
        // The ticker is dependent work: it must be CANCELLABLE so the burst
        // slot is never released while its model call is still in flight
        // (RELIABILITY_PLAN.md item 2).
        const tickerAbort = new AbortController();
        const tickerTask = (async () => {
          try {
            const plan = await generateTickerPlan({
              userMessage: resolvedMessage,
              symbol: body.chartContext?.symbol,
              interval: body.chartContext?.interval,
              intent: previewIntents,
              hasChartContext: Boolean(body.chartContext?.symbol),
              newsProviderConfigured: newsProviderConfigured(),
              canUseMarketTools: true,
              canUseNewsTools: newsProviderConfigured(),
              signal: tickerAbort.signal,
            });
            if (done || req.signal.aborted) return;
            tickerDebug.tickerGenerated = true;
            await streamTicker({
              items: plan,
              sendTicker: (item) => send("ticker", item),
              shouldStop: () => done || req.signal.aborted,
            });
          } catch (error) {
            tickerDebug.tickerHiddenReason = "ticker_generation_failed";
            log.warn("agent.ticker.failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        void tickerTask;

        try {
          const result = await runUnifiedChartAgent({
            userMessage: resolvedMessage,
            chartContext: body.chartContext,
            locale: body.locale,
            requestContext: {
              requestId,
              userId: user.id,
              sessionId,
              emitActivity,
              emitDebug: () => {},
              signal: req.signal,
              session,
            },
            account: null,
            canExecute,
            conversationContext,
          });

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
            metadata: { sessionId },
          });

          // Dynamic, model-generated follow-up suggestions for THIS turn/state.
          // No static fallback: a failure yields [] and the UI shows nothing.
          const suggestions = await generateAgentSuggestions({
            locale: body.locale ?? "ar",
            userMessage: resolvedMessage,
            result,
            symbol: body.chartContext?.symbol,
            interval: body.chartContext?.interval,
            activeRecommendation: result.activeRecommendation,
            maxSuggestions: 4,
          }).catch(() => []);

          // Stop the ticker the moment the final result is ready.
          done = true;

          // Number-reply resolver targets the suggestions actually shown.
          if (suggestions.length) {
            rememberOptions(sessionId, suggestions);
          } else {
            clearOptions(sessionId);
          }

          if (trialMetered) {
            await commitTrialInteraction(user.id, requestId);
          }

          send("final", {
            ...stripInternalFieldsFromClientResult(result),
            sessionId,
            activityEvents,
            // Replace static contextual options with the dynamic suggestions.
            options: suggestions,
            suggestions,
            // Accurate ticker state in dev diagnostics only.
            debugDecisionFlow:
              process.env.NODE_ENV === "development" && result.debugDecisionFlow
                ? { ...result.debugDecisionFlow, ...tickerDebug }
                : undefined,
          });
        } catch (error) {
          if (trialMetered) {
            await releaseTrialInteraction(user.id, requestId);
          }
          if (req.signal.aborted) {
            if (traceRunId) {
              await finalizeAgentRun({ userId: user.id, runId: traceRunId, status: "cancelled" });
            }
            // Cancelled by the user — no partial result, no error badge.
          } else {
            if (traceRunId) {
              await finalizeAgentRun({
                userId: user.id,
                runId: traceRunId,
                status: "failed",
                errorCode: "AGENT_RUN_FAILED",
              });
            }
            const failed = createActivityEvent({
              type: "final",
              status: "failed",
              message: "تعذّر إكمال الطلب بسبب خطأ أثناء تشغيل الوكيل.",
            });
            send("activity", failed);
            // Contract guarantee (RELIABILITY_PLAN.md phase-0 SLO): even a
            // crashed run ends with a COMPLETE `final` event carrying an
            // operational_blocker envelope — never only a bare `error` event.
            const classified = classifyAgentError(error);
            const fallbackResult = buildAgentFallbackResult(
              "Agent run failed before producing a result.",
              activityEvents,
              body.locale ?? "ar",
              {
                detail: userMessageForFailure(classified.code, body.locale ?? "ar"),
                retryable: classified.retryable,
                failureStage: "transport",
                failureCode: classified.code,
                traceId: requestId,
              },
            );
            send("final", {
              ...stripInternalFieldsFromClientResult(fallbackResult),
              sessionId,
              activityEvents,
              options: [],
              suggestions: [],
            });
            // Legacy clients still listen for `error` — keep it, without
            // leaking the raw provider message to the operator.
            send("error", {
              error: userMessageForFailure(classified.code, body.locale ?? "ar"),
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
          if (!sentFinal && !req.signal.aborted) {
            recordRequestWithoutFinal("agent.chat.stream", "no_final_event");
            log.error("agent.stream.slo_breach", { requestId, reason: "no_final_event" });
          }
          done = true; // stop any in-flight ticker loop
          // Do not release the burst slot while dependent work is still running
          // (RELIABILITY_PLAN.md item 2): abort the ticker, then wait — briefly
          // and boundedly — for it to unwind. Otherwise the next run could
          // start while this run's provider calls are still consuming quota.
          tickerAbort.abort();
          // The abort tears the ticker's model call down, so this normally
          // settles in milliseconds; the cap only bounds a pathological unwind
          // (it must stay short — the slot gates the operator's next request).
          await Promise.race([
            tickerTask.catch(() => {}),
            new Promise<void>((resolve) => setTimeout(resolve, 250)),
          ]);
          release?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        // Client aborted the fetch — release the slot promptly.
        release?.();
        if (trialMetered) {
          void releaseTrialInteraction(user.id, requestId);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    release?.();
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "بيانات غير صالحة." },
        { status: 400 },
      );
    }
    return handleError(err);
  }
}

function recommendationContextFromChart(
  chartContext: z.infer<typeof schema>["chartContext"],
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
