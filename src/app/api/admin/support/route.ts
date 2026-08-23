import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { initDb, queryOne } from "@/lib/db";
import { notifySupportReply } from "@/lib/support/notify";
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
    body: z.string().min(1).max(4000),
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
      await addMessage(input.ticket_id, "admin", input.body, admin.id);
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
