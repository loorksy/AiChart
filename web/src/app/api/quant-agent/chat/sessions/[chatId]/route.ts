import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { deleteChat, getChat, getMessages } from "@/lib/agent/chatHistory/chatStore";

/** Load one Quant Agent Chat session (with its messages) that the user owns. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { chatId } = await ctx.params;
    const session = await getChat(userId, chatId, "quant_agent");
    if (!session) throw new ApiError(404, "Chat session not found.");
    const messages = await getMessages(userId, chatId, "quant_agent");
    return NextResponse.json({ session, messages });
  } catch (err) {
    return handleError(err);
  }
}

/** Delete a Quant Agent Chat session the user owns. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { chatId } = await ctx.params;
    const ok = await deleteChat(userId, chatId, "quant_agent");
    if (!ok) throw new ApiError(404, "Chat session not found.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
