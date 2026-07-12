import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError } from "@/lib/api";
import { createChat, listChats } from "@/lib/agent/chatHistory/chatStore";

const createSchema = z
  .object({
    symbol: z.string().max(32).optional(),
    interval: z.string().max(16).optional(),
    language: z.enum(["ar", "en"]).optional(),
    title: z.string().max(200).optional(),
  })
  .partial();

/** List the current user's recent chat sessions (most recent first). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const sessions = await listChats(user.id, Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ sessions });
  } catch (err) {
    return handleError(err);
  }
}

/** Create a fresh chat session for the current user. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const session = await createChat({
      userId: user.id,
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
