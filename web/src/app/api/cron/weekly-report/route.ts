import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { logAudit } from "@/lib/store";
import { buildWeeklyReport, sendWeeklyReports } from "@/lib/weeklyReport";

export const maxDuration = 120;

const CRON_LEADER_LOCK_MS = 115_000;

/** GET = read-only preview of the report; POST = build and send it. */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, report: await buildWeeklyReport() });
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withLock("cron:weekly-report", CRON_LEADER_LOCK_MS, async () => {
    const result = await sendWeeklyReports();
    await logAudit(null, "cron_weekly_report", `sent=${result.sent}`);
    return result;
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  return NextResponse.json({ ok: true, ...run.result });
}
