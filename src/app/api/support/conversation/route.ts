import { NextResponse } from "next/server";
import { handleError, requireUser } from "@/lib/api";
import { initDb } from "@/lib/db";
import {
  addMessage,
  getOrCreateConversation,
  getTicket,
  markConversationRead,
  unreadCount,
} from "@/lib/support/supportStore";
import { intakeSupportAttachment } from "@/lib/support/attachments";
import { checkSupportMessage, supportMessageSchema } from "@/lib/support/messageInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's side of the support conversation.
 *
 * Support is a CONVERSATION, not a queue of tickets: one thread per person,
 * opened where they left it, with history and read state. A ticket list asks
 * the user to file paperwork; this asks them to say what is wrong.
 *
 * Access is by session and by ownership — `requireUser` establishes who is
 * asking, and the thread is looked up BY that id, so a user cannot name
 * someone else's conversation.
 */

/**
 * Read the thread. Opening it marks it read for this side.
 *
 * `?peek=1` is the exception, and it exists for the unread badge: a badge that
 * had to open the conversation to count it would clear the very thing it is
 * counting. Peek reads the number and touches nothing.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    await initDb();
    const ticketId = await getOrCreateConversation(user.id);

    if (new URL(req.url).searchParams.get("peek") === "1") {
      return NextResponse.json({
        ok: true,
        conversation_id: ticketId,
        unread: await unreadCount(ticketId, "user"),
      });
    }

    const thread = await getTicket(ticketId, user.id);
    if (!thread) return NextResponse.json({ ok: false }, { status: 404 });
    // Reading it IS reading it.
    await markConversationRead(ticketId, "user");
    return NextResponse.json({
      ok: true,
      conversation_id: ticketId,
      messages: thread.messages,
      status: thread.ticket.status,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await initDb();
    const parsed = supportMessageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
    }
    const checked = checkSupportMessage(parsed.data);
    if (!checked.ok) {
      return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
    }

    let attachment: { path: string; name: string; bytes: number } | null = null;
    if (checked.attachment) {
      const intake = intakeSupportAttachment(checked.attachment);
      if (!intake.ok) {
        return NextResponse.json({ ok: false, error: intake.reason }, { status: intake.status });
      }
      attachment = intake.attachment;
    }

    const ticketId = await getOrCreateConversation(user.id);
    await addMessage(ticketId, "user", checked.text, user.id, attachment);
    const thread = await getTicket(ticketId, user.id);
    return NextResponse.json({
      ok: true,
      conversation_id: ticketId,
      messages: thread?.messages ?? [],
    });
  } catch (err) {
    return handleError(err);
  }
}
