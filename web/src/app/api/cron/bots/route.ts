import { NextRequest, NextResponse } from "next/server";
import { dispatchBotCycle, runBotCycle } from "@/lib/botEngine";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { queueEnabled } from "@/lib/queue";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;
const CRON_LEADER_LOCK_MS = 290_000;
const log = createLogger("cron:bots");

/**
 * Strategy-bot loop tick. A scheduler hits this frequently; one tick advances
 * every active bot (grid/martingale) for every user. With a worker tier it only
 * dispatches per-user jobs; otherwise it runs the cycle inline.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const endTimer = metrics.cronDuration.startTimer({ job: "bots" });
  const run = await withLock("cron:bots", CRON_LEADER_LOCK_MS, async () =>
    queueEnabled() ? dispatchBotCycle() : runBotCycle(),
  );
  endTimer();
  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  log.info("bot cycle complete", { mode: queueEnabled() ? "dispatch" : "inline" });
  await logAudit(null, "cron_bots", JSON.stringify(run.result));
  return NextResponse.json({ ok: true, ...run.result });
}
