import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { isLLMConfiguredAsync } from "@/lib/llm";
import { resolveSpendGate } from "@/lib/billing/spend";
import { presentRefusal } from "@/lib/billing/refusal";
import { t } from "@/lib/i18n";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { sseEncode } from "@/lib/sse";
import { newId } from "@/lib/agent/activity";
import { createLogger } from "@/lib/logger";
import { runWebChatTurn, webChatBodySchema } from "@/lib/agent/webTurn";
import { publishResidentEvent } from "@/lib/resident/dispatch";
import {
  createTurnStreamClient,
  registerTurnOwner,
  relayTurnStream,
  turnOwner,
  turnQueueEnabled,
  type TurnStreamClient,
} from "@/lib/resident/turnStream";
import { getSettings } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 180;

const log = createLogger("agent.chat.stream");

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // nginx buffers proxied responses by default, which would hold every
  // stage event until the run ends and defeat the whole live checklist.
  "X-Accel-Buffering": "no",
} as const;

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

    const body = webChatBodySchema.parse(await req.json());
    const locale = body.locale ?? "ar";
    const requestId = newId();

    // THE gate — the only thing that decides whether this turn may run.
    // There was a second, older gate in front of it whose message was
    // hardcoded to "your free trial ended"; it answered first, so an expired
    // SUBSCRIBER was told their trial had ended and the correct
    // subscription_expired code below was never reached. One gate now.
    const chatGate = await resolveSpendGate(user.id, "chat_turn");
    if (!chatGate.allowed) {
      const view = presentRefusal(locale, chatGate);
      return NextResponse.json(
        {
          error: view.message,
          code: chatGate.code,
          // The action decides the button: an empty balance sends a Free
          // account to subscribe and a subscriber to a top-up.
          action: chatGate.action,
          cta: { label: view.ctaLabel, path: view.ctaPath },
          balance: chatGate.balance,
        },
        { status: chatGate.code === "insufficient_credits" ? 402 : 403 },
      );
    }

    const sessionId = body.sessionId ?? newId();

    // Work B (design A2): with REDIS_URL the web process never runs the
    // agent. The turn is published to the resident queue — the worker runs
    // it, meters usage, and commits the balance — and this route becomes a
    // relay over the per-turn stream. Closing the tab only stops the relay;
    // the run completes and the answer waits in history. Without REDIS_URL
    // the in-process path below is exactly the pre-queue behavior.
    if (turnQueueEnabled()) {
      const client = await createTurnStreamClient();
      try {
        await registerTurnOwner(client, requestId, user.id);
        await publishResidentEvent({
          kind: "user_message",
          userId: user.id,
          channel: { type: "web", id: sessionId },
          text: body.message,
          web: {
            turnId: requestId,
            locale,
            // Pin the user's model choice at send time, like the price of a
            // checkout: a settings change mid-queue does not retarget a
            // turn the user already sent.
            modelRef: (await getSettings(user.id)).preferred_model_ref ?? null,
            chartContext: body.chartContext,
          },
          enqueuedAt: Date.now(),
        });
      } catch (err) {
        await client.quit().catch(() => {});
        throw err;
      }
      return relayResponse({ client, turnId: requestId, cursor: "0", signal: req.signal });
    }

    // Burst guard: one heavy agent run per user + global cap (rate limiting).
    // Queue mode replaces this with the worker's own slot wait — one gate.
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

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(sseEncode(event, data));
          } catch {
            /* client gone — keep working so audit + state persist */
          }
        };
        // Heartbeat: long stages (decision model, captures) must never read as
        // a dead stream. Unknown SSE event names are ignored by old clients.
        const heartbeat = setInterval(() => {
          send("heartbeat", { t: Date.now() });
        }, 3000);
        try {
          await runWebChatTurn({
            user,
            body,
            requestId,
            sessionId,
            signal: req.signal,
            emit: send,
          });
        } finally {
          clearInterval(heartbeat);
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
      headers: { ...SSE_HEADERS, "X-Turn-Id": requestId },
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

const resumeQuerySchema = z.object({
  turn: z.string().min(1).max(64),
  cursor: z.string().min(1).max(64),
});

/**
 * Resume (approved decision 2): a client that lost the relay mid-run
 * reconnects with the last stream-entry id it read and the relay continues
 * from that position — same events, same payloads, nothing replayed twice.
 * Queue mode only; inline runs die with their connection (as before) and
 * the history-recovery poll remains the fallback everywhere.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requirePlatformAccess();
    if (!turnQueueEnabled()) {
      return NextResponse.json({ error: "turn relay not enabled" }, { status: 404 });
    }
    const params = resumeQuerySchema.parse({
      turn: req.nextUrl.searchParams.get("turn"),
      cursor: req.nextUrl.searchParams.get("cursor"),
    });
    const client = await createTurnStreamClient();
    const owner = await turnOwner(client, params.turn).catch(() => null);
    if (owner !== user.id) {
      await client.quit().catch(() => {});
      return NextResponse.json({ error: "unknown turn" }, { status: 404 });
    }
    return relayResponse({
      client,
      turnId: params.turn,
      cursor: params.cursor,
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(err);
  }
}

/**
 * The relay: translate per-turn stream entries into SSE frames verbatim.
 * Each frame carries an `id:` line (the resume cursor) ahead of the exact
 * `event:`/`data:` lines the inline path emits — parsers that only read
 * event/data are byte-compatible. Heartbeats are generated HERE: they are
 * transport liveness, not agent output, so they never enter the stream.
 */
function relayResponse(opts: {
  client: TurnStreamClient;
  turnId: string;
  cursor: string;
  signal: AbortSignal;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* client gone — the worker keeps running regardless */
        }
      };
      const heartbeat = setInterval(() => {
        push(`event: heartbeat\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
      }, 3000);
      // Break the blocking XREAD promptly when the client goes away.
      const onAbort = () => {
        void opts.client.quit().catch(() => {});
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
      try {
        await relayTurnStream({
          client: opts.client,
          turnId: opts.turnId,
          cursor: opts.cursor,
          signal: opts.signal,
          onFrame: (frame) => {
            push(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${frame.data}\n\n`);
          },
        });
      } catch (err) {
        if (!opts.signal.aborted) {
          log.warn("turn relay failed", {
            turnId: opts.turnId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        clearInterval(heartbeat);
        opts.signal.removeEventListener("abort", onAbort);
        await opts.client.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      void opts.client.quit().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: { ...SSE_HEADERS, "X-Turn-Id": opts.turnId },
  });
}
