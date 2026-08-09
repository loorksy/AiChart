import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { createChat, listChats } from "@/lib/agent/chatHistory/chatStore";

/**
 * Thin CRUD wrapper around `chatStore`, hardcoding `agentId: "quant_agent"`
 * (plan §3) — mirrors `@/app/api/agent/chats/route.ts` for Lonora, but scoped
 * to the isolated Quant Agent Chat agent id so the two never cross-list.
 */

const createSchema = z
  .object({
    symbol: z.string().max(32).optional(),
    interval: z.string().max(16).optional(),
    language: z.enum(["ar", "en"]).optional(),
    title: z.string().max(200).optional(),
  })
  .partial();

/** List the current user's recent Quant Agent Chat sessions (most recent first). */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const sessions = await listChats(userId, "quant_agent", Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ sessions });
  } catch (err) {
    return handleError(err);
  }
}

/** Create a fresh Quant Agent Chat session for the current user. */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const session = await createChat({
      userId,
      agentId: "quant_agent",
      symbol: body.symbol,
      interval: body.interval,
      language: body.language,
      title: body.title,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
