import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import { listRecentLessons } from "@/lib/tradeMemory";

/** Latest post-mortem lessons for the command center sidebar. */
export async function GET() {
  try {
    const user = await requirePlatformAccess();
    const lessons = await listRecentLessons(user.id, 3);
    return NextResponse.json({ ok: true, lessons });
  } catch (e) {
    return handleError(e);
  }
}
