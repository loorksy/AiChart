import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { createLogger } from "@/lib/logger";
import { withLock } from "@/lib/locks";
import { metrics } from "@/lib/metrics";
import { queueEnabled } from "@/lib/queue";
import { dispatchScalpCycle, runScalpCycle } from "@/lib/scalpEngine";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;

/** Leader lease just under maxDuration so a slow cycle is never double-run. */
const CRON_LEADER_LOCK_MS = 290_000;

const log = createLogger("cron:scalp");

/**
 * Autonomous scalp loop tick. A scheduler hits this frequently (≤1m via system
 * cron, or sub-minute via a pm2 ticker). One tick runs a full cycle for every
 * active scalp session. Execution stays behind executeIntent → Risk Guard.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const endTimer = metrics.cronDuration.startTimer({ job: "scalp" });
  // With a worker tier (Redis) the cron only DISPATCHES per-user jobs (fast) so
  // heavy agent work runs off the request; otherwise it runs the cycle inline.
  const run = await withLock("cron:scalp", CRON_LEADER_LOCK_MS, async () =>
    queueEnabled() ? dispatchScalpCycle() : runScalpCycle(),
  );
  endTimer();
  if (!run.ran) {
    log.warn("skipped — another cycle holds the leader lock");
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  log.info("cycle complete", { mode: queueEnabled() ? "dispatch" : "inline", ...run.result });
  await logAudit(null, "cron_scalp", JSON.stringify(run.result));

  return NextResponse.json({ ok: true, ...run.result });
}
