import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { confirmQuantAgentMemory } from "@/lib/agent/quantAgentChat/memory";

/**
 * The ONLY endpoint that calls `confirmQuantAgentMemory` (plan §6) — reached
 * exclusively by the user pressing "Remember this" in
 * `QuantAgentMemorySaveBanner`. `draftMemoryCandidate` only ever suggests;
 * this is the sole write path.
 */
const schema = z.object({
  content: z.string().min(1).max(2000),
  chatId: z.string().min(1).max(64).optional(),
  locale: z.enum(["ar", "en"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const body = schema.parse(await req.json());
    const memory = await confirmQuantAgentMemory(userId, body.content, {
      chatId: body.chatId,
      locale: body.locale,
    });
    return NextResponse.json({ ok: true, memory }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    return handleError(err);
  }
}
