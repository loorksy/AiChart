import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleError } from "@/lib/api";
import { resolveQuantAgentUserId } from "@/lib/quantAgent/webAuth";
import { getChat, getMessages } from "@/lib/agent/chatHistory/chatStore";

/**
 * Read-only history for one Quant Agent Chat session. Also backs the
 * `quant_agent_chat_history` MCP tool (read-only).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ chatId: string }> }) {
  try {
    const userId = await resolveQuantAgentUserId(req);
    const { chatId } = await ctx.params;
    const session = await getChat(userId, chatId, "quant_agent");
    if (!session) throw new ApiError(404, "Chat session not found.");
    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 500);
    const limit = Number.isFinite(limitParam) ? limitParam : 500;
    const messages = await getMessages(userId, chatId, "quant_agent", limit);
    return NextResponse.json({ messages });
  } catch (err) {
    return handleError(err);
  }
}
