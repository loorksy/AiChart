import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { queueEnabled } from "@/lib/queue";
import { logAudit } from "@/lib/store";
import {
  getStrategyPipelineStatus,
  pipelineConfig,
  runStrategyPipelineTick,
} from "@/lib/strategies/pipeline";

export const maxDuration = 120;

const log = createLogger("cron:strategy-pipeline");
const LEADER_LOCK_MS = 110_000;

/** Read-only pipeline health: state counts + which gates kill candidates. */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = pipelineConfig();
  if (config.userId == null) {
    return NextResponse.json({
      ok: false,
      reason: "STRATEGY_PIPELINE_USER_ID is not configured",
    });
  }
  const status = await getStrategyPipelineStatus(config.userId);
  return NextResponse.json({
    ok: true,
    config: {
      symbols: config.symbols,
      timeframes: config.timeframes,
      batch: config.batch,
    },
    ...status,
  });
}

/**
 * One pipeline heartbeat: advance up to `batch` in-flight backtests through
 * the existing evidence state machine and submit missing catalog combos.
 *
 * Heavy work runs in BullMQ jobs. Without REDIS_URL the inline fallback would
 * execute research jobs INSIDE this cron request (blowing its duration), so
 * the tick deliberately no-ops with a logged warning instead.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!queueEnabled()) {
    log.warn("REDIS_URL is not set — strategy pipeline requires the worker tier");
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "REDIS_URL is required: the pipeline must run on the worker tier, not inline in a cron request",
    });
  }

  const run = await withLock("cron:strategy-pipeline", LEADER_LOCK_MS, async () => {
    const config = pipelineConfig();
    const result = await runStrategyPipelineTick(config);
    if (result.advanced || result.submitted) {
      log.info("pipeline tick", { ...result });
      if (config.userId != null) {
        await logAudit(
          config.userId,
          "strategy_pipeline_tick",
          `advanced=${result.advanced} submitted=${result.submitted} inflight=${result.inflight} remaining=${result.remainingTargets}`,
        ).catch(() => {});
      }
    }
    return result;
  });

  if (!run.ran) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already running" });
  }
  return NextResponse.json({ ok: true, ...run.result });
}
