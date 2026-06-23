import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { createLogger } from "@/lib/logger";
import { withLock } from "@/lib/locks";
import { runScalpCycle } from "@/lib/scalpEngine";
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

  const startedAt = Date.now();
  const run = await withLock("cron:scalp", CRON_LEADER_LOCK_MS, runScalpCycle);
  if (!run.ran) {
    log.warn("skipped — another cycle holds the leader lock");
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  const cycle = run.result;
  log.info("cycle complete", {
    sessions: cycle.sessions,
    events: cycle.events.length,
    errors: cycle.errors.length,
    durationMs: Date.now() - startedAt,
  });
  await logAudit(
    null,
    "cron_scalp",
    `sessions=${cycle.sessions} events=${cycle.events.length} errors=${cycle.errors.length}`,
  );

  return NextResponse.json({ ok: true, ...cycle });
}
