import { NextResponse } from "next/server";
import { handleError, requireAdmin } from "@/lib/api";
import { PRESENCE_TIMEZONE, readTraffic } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminTrafficResponse {
  ok: true;
  live: number;
  today: number;
  timezone: string;
  recent_paths: { path: string; count: number }[];
}

/**
 * Anonymous public-page visitors. Any admin may read this — it is not
 * profit_read gated, and it is not registered-user counts.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    const stats = await readTraffic();
    const body: AdminTrafficResponse = {
      ok: true,
      live: stats.live,
      today: stats.today,
      timezone: stats.timezone || PRESENCE_TIMEZONE,
      recent_paths: stats.recent_paths,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleError(err);
  }
}
