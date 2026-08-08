import { NextRequest, NextResponse } from "next/server";
import { requireUser, handleError, ApiError } from "@/lib/api";
import {
  deleteChat,
  getChat,
  getMessages,
} from "@/lib/agent/chatHistory/chatStore";

/** Load one chat session (with its messages) that the user owns. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser();
    const { chatId } = await ctx.params;
    const session = await getChat(user.id, chatId, "lonora");
    if (!session) throw new ApiError(404, "المحادثة غير موجودة.");
    const messages = await getMessages(user.id, chatId, "lonora");
    return NextResponse.json({ session, messages });
  } catch (err) {
    return handleError(err);
  }
}

/** Delete a chat session the user owns. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ chatId: string }> },
) {
  try {
    const user = await requireUser();
    const { chatId } = await ctx.params;
    const ok = await deleteChat(user.id, chatId, "lonora");
    if (!ok) throw new ApiError(404, "المحادثة غير موجودة.");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
