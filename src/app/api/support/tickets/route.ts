import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { createTicket, listUserTickets } from "@/lib/support/supportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-C (#97): the signed-in user's tickets. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  return NextResponse.json({ ok: true, tickets: await listUserTickets(user.id) });
}

const createSchema = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(5).max(4000),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 },
    );
  }
  const ticketId = await createTicket(user.id, parsed.data.subject, parsed.data.body);
  return NextResponse.json({ ok: true, ticket_id: ticketId });
}
