import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { runQuantAgentChatTurn } from "@/lib/agent/quantAgentChat/orchestrator";

/**
 * Non-streaming variant of the chat turn (plan §3). Reuses
 * `runQuantAgentChatTurn` exactly like `stream/route.ts` — the only
 * difference is that no `onDelta` callback is passed, so the orchestrator
 * collects the full reply with `callLLM` instead of `callLLMStream` and this
 * route returns it as one JSON object. Exists specifically for
 * server-to-server callers (the sibling `quant_agent_chat_send` MCP tool)
 * that need one synchronous response without parsing an SSE stream.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

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
    const result = await runQuantAgentChatTurn({
      userId,
      chatId: body.chatId,
      message: body.message,
      locale: body.locale,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
