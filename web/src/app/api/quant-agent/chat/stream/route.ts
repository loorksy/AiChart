import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { sseEncode } from "@/lib/sse";
import { createLogger } from "@/lib/logger";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { QuantAgentChatError, runQuantAgentChatTurn } from "@/lib/agent/quantAgentChat/orchestrator";

/**
 * SSE streaming endpoint for the browser chat UI (plan §3). Mirrors the SHAPE
 * of `@/app/api/agent/chat/stream/route.ts` (auth resolution, a ReadableStream
 * wrapping `sseEncode` events) but calls `runQuantAgentChatTurn` — a small,
 * separate orchestrator — instead of Lonora's 813-line route.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const log = createLogger("quantAgentChat.stream");

const schema = z.object({
  chatId: z.string().min(1).max(64),
  message: z.string().min(1).max(4000),
  locale: z.enum(["ar", "en"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    if (!quantAgentServiceEnabled()) {
      return NextResponse.json({ error: "Quant Agent Service is not enabled." }, { status: 503 });
    }
    const body = schema.parse(await req.json());

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(sseEncode(event, data));
          } catch {
            /* client gone */
          }
        };
        try {
          const result = await runQuantAgentChatTurn({
            userId,
            chatId: body.chatId,
            message: body.message,
            locale: body.locale,
            // Cumulative sanitized-free text so far — replace semantics on
            // the client, matching the pattern documented in @/lib/sse.
            onDelta: (fullText) => send("delta", { text: fullText }),
          });
          send("done", result);
        } catch (error) {
          if (error instanceof QuantAgentChatError) {
            send("error", { error: error.message, code: error.code });
          } else {
            log.error("quant_agent_chat.stream.failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            send("error", { error: "Quant Agent Chat failed to respond." });
          }
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        /* client aborted the fetch — nothing to release */
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // nginx buffers proxied responses by default, which would hold every
        // delta until the run ends and defeat live streaming.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
