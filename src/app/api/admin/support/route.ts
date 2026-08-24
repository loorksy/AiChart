import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { initDb, queryOne } from "@/lib/db";
import { notifySupportReply } from "@/lib/support/notify";
import { intakeSupportAttachment } from "@/lib/support/attachments";
import { checkSupportMessage, supportMessageSchema } from "@/lib/support/messageInput";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  addMessage,
  adminUnreadTotal,
  assignTicket,
  closeTicket,
  getTicket,
  listAllTickets,
  markConversationRead,
  unreadCount,
} from "@/lib/support/supportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-C (#97): the support inbox — `tickets` permission (support role and up). */
export async function GET(req: NextRequest) {
  try {
    await requireAdminWith("tickets");
    await initDb();
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    // The rail's badge, and nothing else. It is polled, so it must not drag
    // two hundred conversation rows and a per-row count across the wire every
    // minute just to draw one number.
    if (req.nextUrl.searchParams.get("count") === "1") {
      return NextResponse.json({ ok: true, unread_total: await adminUnreadTotal() });
    }
    const ticketId = req.nextUrl.searchParams.get("ticket");
    if (ticketId) {
      const thread = await getTicket(Number(ticketId));
      if (!thread) return NextResponse.json({ ok: false }, { status: 404 });
      // Opening a conversation IS reading it — the user stops seeing their
      // message as unanswered-and-unseen.
      await markConversationRead(Number(ticketId), "admin");
      return NextResponse.json({ ok: true, ...thread });
    }
    const tickets = await listAllTickets(status);
    // Per-conversation unread, so the inbox can show what is actually waiting
    // rather than only what is open.
    const unread: Record<number, number> = {};
    for (const ticket of tickets) {
      unread[ticket.id] = await unreadCount(ticket.id, "admin");
    }
    return NextResponse.json({
      ok: true,
      tickets,
      unread,
      unread_total: await adminUnreadTotal(),
    });
  } catch (err) {
    return handleError(err);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ticket_id: z.coerce.number().int().positive() }),
  z.object({ action: z.literal("close"), ticket_id: z.coerce.number().int().positive() }),
  z.object({
    action: z.literal("reply"),
    // Coerced: the id round-trips through the panel's own list response, and a
    // driver or cache that stringifies it must not turn a reply into a 400.
    ticket_id: z.coerce.number().int().positive(),
    // The SAME rule the user's side uses — the console is the other end of one
    // conversation, not a stricter surface of its own.
    ...supportMessageSchema.shape,
  }),
]);

export async function POST(req: NextRequest) {
  try {
    const { admin } = await requireAdminWith("tickets");
    await initDb();
    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid action" }, { status: 400 });
    }
    const input = parsed.data;
    if (input.action === "assign") await assignTicket(input.ticket_id, admin.id);
    if (input.action === "close") await closeTicket(input.ticket_id);
    if (input.action === "reply") {
      const checked = checkSupportMessage(input);
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
      await addMessage(input.ticket_id, "admin", checked.text, admin.id, attachment);
      await assignTicket(input.ticket_id, admin.id);
      // Tell the person waiting. Best-effort and deliberately un-awaited in
      // effect: the reply is already stored, and a notification that fails
      // must never cost the message that triggered it.
      const owner = await queryOne<{ user_id: number }>(
        "SELECT user_id FROM support_tickets WHERE id = ?",
        [input.ticket_id],
      );
      if (owner) void notifySupportReply(owner.user_id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
