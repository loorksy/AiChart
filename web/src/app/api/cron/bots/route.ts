import { NextRequest, NextResponse } from "next/server";
import { runBotCycle } from "@/lib/botEngine";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { metrics } from "@/lib/metrics";
import { logAudit } from "@/lib/store";

export const maxDuration = 300;
const CRON_LEADER_LOCK_MS = 290_000;
const log = createLogger("cron:bots");

/**
 * Strategy-bot loop tick. Cron hits this every minute; runs all active bots
 * inline on the web process (reliable EA/MetaApi env).
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const endTimer = metrics.cronDuration.startTimer({ job: "bots" });
  const run = await withLock("cron:bots", CRON_LEADER_LOCK_MS, async () =>
    // Run inline on the web process — full Next.js .env + EA/MetaApi context.
    // Queue dispatch alone left bots idle when worker env/cron was misconfigured.
    runBotCycle(),
  );
  endTimer();
  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }
  log.info("bot cycle complete", { mode: "inline" });
  await logAudit(null, "cron_bots", JSON.stringify(run.result));
  return NextResponse.json({ ok: true, ...run.result });
}
