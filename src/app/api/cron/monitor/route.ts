import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { metrics } from "@/lib/metrics";
import { enqueue, queueEnabled } from "@/lib/queue";
import { runCronPostScan } from "@/lib/cronPostScan";
import { runOpportunityScan } from "@/lib/opportunityScan";
import { listUsersForMonitor, logAudit } from "@/lib/store";

export const maxDuration = 300;

const CRON_LEADER_LOCK_MS = 290_000;

/** 24/7 monitor cron — cheap scan + optional deep analysis per active user. */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const endTimer = metrics.cronDuration.startTimer({ job: "monitor" });
  const run = await withLock("cron:monitor", CRON_LEADER_LOCK_MS, async () => {
    const users = await listUsersForMonitor();

    // With a worker tier, enqueue one deep-scan job per user (fast) and let
    // workers run the LLM-heavy analysis; otherwise scan inline.
    if (queueEnabled()) {
      for (const { id } of users) {
        await enqueue("opportunity_scan", { userId: id });
      }
      const post = await runCronPostScan();
      return { users: users.length, dispatched: users.length, post };
    }

    const scans: Array<{ userId: number; candidates: number; errors: string[] }> =
      [];
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
    return { users: users.length, scans, post };
  });
  endTimer();

  await logAudit(null, "cron_monitor", JSON.stringify({ ran: run.ran }));
  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  return NextResponse.json({ ok: true, ...run.result });
}
