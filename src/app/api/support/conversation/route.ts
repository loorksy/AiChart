import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, requireUser } from "@/lib/api";
import { initDb } from "@/lib/db";
import {
  addMessage,
  getOrCreateConversation,
  getTicket,
  markConversationRead,
  unreadCount,
} from "@/lib/support/supportStore";
import { storeSupportAttachment, validateSupportAttachment } from "@/lib/support/attachments";

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

/** Read the thread. Opening it marks it read for this side. */
export async function GET() {
  try {
    const user = await requireUser();
    await initDb();
    const ticketId = await getOrCreateConversation(user.id);
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

const sendSchema = z.object({
  body: z.string().max(4000).optional(),
  /** An optional file, base64, bounded and type-checked server-side. */
  attachment: z
    .object({
      name: z.string().min(1).max(200),
      data_base64: z.string().min(8),
    })
    .optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    await initDb();
    const parsed = sendSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload" }, { status: 400 });
    }
    const text = parsed.data.body?.trim() ?? "";
    if (!text && !parsed.data.attachment) {
      return NextResponse.json({ ok: false, error: "empty_message" }, { status: 400 });
    }

    let attachment: { path: string; name: string; bytes: number } | null = null;
    if (parsed.data.attachment) {
      const bytes = Buffer.from(parsed.data.attachment.data_base64, "base64");
      const verdict = validateSupportAttachment(bytes);
      if (!verdict.ok) {
        return NextResponse.json(
          { ok: false, error: verdict.reason },
          { status: verdict.reason === "too_large" ? 413 : 415 },
        );
      }
      attachment = {
        path: storeSupportAttachment(bytes, verdict.ext),
        name: parsed.data.attachment.name,
        bytes: bytes.length,
      };
    }

    const ticketId = await getOrCreateConversation(user.id);
    await addMessage(ticketId, "user", text, user.id, attachment);
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
