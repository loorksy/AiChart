import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import {
  addMessage,
  getTicket,
  requestHuman,
} from "@/lib/support/supportStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** V2-C (#97): one ticket thread — owner-scoped. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const { id } = await params;
  const thread = await getTicket(Number(id), user.id);
  if (!thread) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, ...thread });
}

const messageSchema = z.object({ body: z.string().min(1).max(4000) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const { id } = await params;
  const ticketId = Number(id);
  const thread = await getTicket(ticketId, user.id);
  if (!thread) return NextResponse.json({ ok: false }, { status: 404 });
  const parsed = messageSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid message" }, { status: 400 });
  }
  await addMessage(ticketId, "user", parsed.data.body, user.id);
  // "I want a human" — the escalation phrase flips the flag for the inbox.
  if (/أريد مشرف|مشرف بشري|human/i.test(parsed.data.body)) {
    await requestHuman(ticketId);
  }
  return NextResponse.json({ ok: true });
}
