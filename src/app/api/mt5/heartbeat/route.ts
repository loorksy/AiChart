import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { markPresence } from "@/lib/metaapi/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-B (#96): the presence beat. The console shell posts here every few
 * minutes while a tab is open; the beat refreshes mt_presence and silently
 * redeploys an idle-undeployed MetaApi account so the user never notices
 * the cost saving happening underneath them.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await initDb();
  const { redeployed } = await markPresence(user.id);
  return NextResponse.json({ ok: true, redeployed });
}
