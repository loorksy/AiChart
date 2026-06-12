import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { runCronPostScan } from "@/lib/cronPostScan";
import { runOpportunityScan } from "@/lib/opportunityScan";
import { listUsersForMonitor, logAudit } from "@/lib/store";

export const maxDuration = 300;

/** 24/7 monitor cron — cheap scan + optional deep analysis per active user. */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await listUsersForMonitor();
  const scans: Array<{
    userId: number;
    candidates: number;
    errors: string[];
  }> = [];

  for (const { id, settings, limits } of users) {
    try {
      const scan = await runOpportunityScan(id, settings, limits, {
        deep: true,
      });
      scans.push({
        userId: id,
        candidates: scan.candidates.length,
        errors: scan.errors,
      });
    } catch (e) {
      scans.push({
        userId: id,
        candidates: 0,
        errors: [e instanceof Error ? e.message : "error"],
      });
    }
  }

  const post = await runCronPostScan();
  await logAudit(null, "cron_monitor", `users=${users.length}`);

  return NextResponse.json({
    ok: true,
    users: users.length,
    scans,
    post,
  });
}
