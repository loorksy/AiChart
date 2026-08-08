import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, handleError, ApiError } from "@/lib/api";
import { appendMessage, getMessages } from "@/lib/agent/chatHistory/chatStore";
import { refreshChatMetaAfterAssistantTurn } from "@/lib/agent/chatHistory/refreshChatMeta";

const appendSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20000),
  result: z.unknown().optional(),
  recommendationId: z.string().max(128).optional(),
  analysisId: z.string().max(128).optional(),
  symbol: z.string().max(32).optional(),
  interval: z.string().max(16).optional(),
});

/** List all messages for a chat the user owns. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser();
    const { chatId } = await ctx.params;
    const messages = await getMessages(user.id, chatId, "lonora");
    return NextResponse.json({ messages });
  } catch (err) {
    return handleError(err);
  }
}

/** Append a user/assistant message to a chat the user owns. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser();
    const { chatId } = await ctx.params;
    const body = appendSchema.parse(await req.json());
    const message = await appendMessage(user.id, chatId, { ...body, agentId: "lonora" });
    if (!message) throw new ApiError(404, "المحادثة غير موجودة.");
    // AI title/hook after assistant turns — never delay the response.
    if (body.role === "assistant") {
      void refreshChatMetaAfterAssistantTurn(user.id, chatId, "lonora");
    }
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
