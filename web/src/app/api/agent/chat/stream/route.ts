import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { getSettings, getLimits } from "@/lib/store";
import { isLLMConfigured } from "@/lib/llm";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { sseEncode } from "@/lib/sse";
import { FEATURES } from "@/lib/agent/featureFlags";
import {
  createActivityEvent,
  newId,
  shouldShowActivity,
} from "@/lib/agent/activity";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import { buildUserTradingProfile } from "@/lib/agent/risk/userTradingProfile";
import {
  updateSessionFromMessage,
  rememberContext,
} from "@/lib/agent/sessionMemory";
import {
  resolveOptionReply,
  rememberOptions,
  DEFAULT_AGENT_OPTIONS,
} from "@/lib/agent/sessionOptions";
import { routeIntent } from "@/lib/agent/intentRouter";
import { generateTickerPlan } from "@/lib/agent/ticker/generateTickerPlan";
import { streamTicker } from "@/lib/agent/ticker/streamTicker";
import { newsProviderConfigured } from "@/lib/agent/news/newsProvider";
import { createLogger } from "@/lib/logger";
import { writeAgentAudit } from "@/lib/agent/auditLog";
import { tradingStyleForInterval } from "@/lib/analysisProfile";
import type { AgentActivityEvent } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const log = createLogger("agent.chat.stream");

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
      dataSource: z.enum(["oanda", "ea"]).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const user = await requirePlatformAccess();

    if (!FEATURES.smartChartAgent()) {
      return NextResponse.json(
        { error: "الوكيل الذكي غير مُفعّل حالياً." },
        { status: 503 },
      );
    }
    if (!isLLMConfigured()) {
      return NextResponse.json(
        { error: "الذكاء الاصطناعي غير مُفعّل على الخادم." },
        { status: 503 },
      );
    }

    const body = schema.parse(await req.json());

    // Burst guard: one heavy agent run per user + global cap (rate limiting).
    const slot = acquireAnalyzeSlot(user.id);
    if (!slot.ok) {
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

    const [settings, limits] = await Promise.all([
      getSettings(user.id),
      getLimits(user.id),
    ]);
    const profile = buildUserTradingProfile(settings);
    const canExecute = limits.can_execute !== 0;

    const sessionId = body.sessionId ?? newId();

    // If the last assistant turn offered numbered options and the user replied
    // with a bare index ("1" / "١"), resolve it to that option's real prompt
    // instead of treating it as a new general question.
    const resolvedMessage =
      resolveOptionReply(sessionId, body.message) ?? body.message;

    // Fold any preference directives into session memory before the run.
    const session = updateSessionFromMessage(sessionId, resolvedMessage);
    const tradingStyle = tradingStyleForInterval(
      body.chartContext?.interval ?? "15m",
    );

    const requestId = newId();
    const activityEvents: AgentActivityEvent[] = [];

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
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
            requestContext: {
              requestId,
              userId: user.id,
              sessionId,
              emitActivity,
              emitDebug: () => {},
              signal: req.signal,
              session,
            },
            profile,
            account: null,
            canExecute,
            tradingStyle,
          });

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
            riskVeto: result.decision === "wait",
            newsRisk: result.newsRisk?.level,
            executionRequiresConfirmation: result.requiresConfirmation,
            executionConfirmed: false,
            summary: result.summary,
            metadata: { sessionId },
          });

          // Stop the ticker the moment the final result is ready.
          done = true;

          // After a general/informational reply, offer the capability options
          // so the user can just answer "1"/"2" next. Clear them after a real
          // analysis so a stale index can't hijack the next message.
          if (result.decision === "informational") {
            rememberOptions(sessionId, DEFAULT_AGENT_OPTIONS);
          }

          send("final", {
            ...result,
            sessionId,
            activityEvents,
            options:
              result.decision === "informational"
                ? DEFAULT_AGENT_OPTIONS
                : undefined,
            // Accurate ticker state in dev diagnostics.
            debugDecisionFlow: result.debugDecisionFlow
              ? { ...result.debugDecisionFlow, ...tickerDebug }
              : undefined,
          });
        } catch (error) {
          if (req.signal.aborted) {
            // Cancelled by the user — no partial result, no error badge.
          } else {
            const failed = createActivityEvent({
              type: "final",
              status: "failed",
              message: "تعذّر إكمال الطلب بسبب خطأ أثناء تشغيل الوكيل.",
            });
            send("activity", failed);
            send("error", {
              error: error instanceof Error ? error.message : "Agent failed",
            });
          }
        } finally {
          done = true; // stop any in-flight ticker loop
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
