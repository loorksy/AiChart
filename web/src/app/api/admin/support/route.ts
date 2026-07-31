import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleError } from "@/lib/api";
import { initDb } from "@/lib/db";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  addMessage,
  assignTicket,
  closeTicket,
  getTicket,
  listAllTickets,
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
      return NextResponse.json({ ok: true, ...thread });
    }
    return NextResponse.json({ ok: true, tickets: await listAllTickets(status) });
  } catch (err) {
    return handleError(err);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ticket_id: z.number().int().positive() }),
  z.object({ action: z.literal("close"), ticket_id: z.number().int().positive() }),
  z.object({
    action: z.literal("reply"),
    ticket_id: z.number().int().positive(),
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
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
