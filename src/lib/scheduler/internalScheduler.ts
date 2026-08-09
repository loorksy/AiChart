import { createLogger } from "@/lib/logger";

const log = createLogger("scheduler.internal");

/**
 * In-process fallback scheduler for long-lived (VPS / standalone) deployments.
 *
 * The platform's freshness pipeline assumes something is regularly warming the
 * candle warehouse (`/api/cron/candle-warehouse`, every 10 min) and sweeping
 * tracked recommendations (`/api/cron/recommendation-sweep`, every 5 min). On
 * a VPS those only run if the operator installed `/etc/cron.d/aichart` with
 * the right domain + CRON_SECRET — and when that's missing or wrong the
 * warehouse goes cold (every first analysis fails the freshness gate) and
 * conditional recommendations are NEVER evaluated, which reads to the user as
 * "my condition happened and the agent did nothing".
 *
 * This scheduler removes that external dependency: plain `setInterval` inside
 * the Next.js node process, with each tick funneled through the same
 * distributed `withLock` leases the cron routes use, so external cron (if
 * installed) and multiple replicas never double-run work.
 *
 * Enabled when `INTERNAL_SCHEDULER=1` (recommended on VPS) or by default when
 * not on Vercel serverless (long-lived process detected). Disable explicitly
 * with `INTERNAL_SCHEDULER=0`.
 */

const WARM_INTERVAL_MS = 3 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const WARM_LOCK_MS = 170_000;
const SWEEP_LOCK_MS = 290_000;

export interface InternalSchedulerStatus {
  enabled: boolean;
  startedAt: number | null;
  warmLastRunAt: number | null;
  warmLastError: string | null;
  sweepLastRunAt: number | null;
  sweepLastError: string | null;
}

const state: InternalSchedulerStatus = {
  enabled: false,
  startedAt: null,
  warmLastRunAt: null,
  warmLastError: null,
  sweepLastRunAt: null,
  sweepLastError: null,
};

/** Exposed for the healthz diagnostics endpoint. */
export function internalSchedulerStatus(): InternalSchedulerStatus {
  return { ...state };
}

function schedulerEnabled(): boolean {
  const flag = (process.env.INTERNAL_SCHEDULER ?? "").trim();
  if (flag === "1") return true;
  if (flag === "0") return false;
  // Default: on for long-lived processes (VPS/standalone), off on Vercel
  // serverless where setInterval does not survive between invocations anyway.
  return !process.env.VERCEL;
}

/**
 * Warm the series the platform was actually asked for. Mirrors the demand
 * branch of the candle-warehouse cron but skips the deep completeness work —
 * the goal here is a warm tail, not historical depth.
 */
async function warmTick(): Promise<void> {
  const { withLock } = await import("@/lib/locks");
  const outcome = await withLock("cron:candle-warehouse", WARM_LOCK_MS, async () => {
    const { pickWarehouseFeederUserId, maintainCandleSeries } = await import(
      "@/lib/candles/candleBackfillService"
    );
    if ((await pickWarehouseFeederUserId()) == null) {
      return { skipped: "no_feeder_account", processed: 0 };
    }
    const { listWarmDemand } = await import("@/lib/candles/warmDemand");
    const demand = await listWarmDemand();
    // Newest demand first; keep each tick cheap.
    const selected = demand.slice(0, 6);
    let processed = 0;
    for (const series of selected) {
      try {
        await maintainCandleSeries({
          symbol: series.symbol,
          interval: series.interval,
        });
        processed += 1;
      } catch (error) {
        log.warn("warm tick series failed", {
          symbol: series.symbol,
          interval: series.interval,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { skipped: null, processed };
  });
  if (outcome.ran) {
    state.warmLastRunAt = Date.now();
    state.warmLastError = null;
    log.debug("warm tick done", outcome.result);
  }
}

/** Evaluate tracked recommendations — activation, targets, stops, expiry. */
async function sweepTick(): Promise<void> {
  const { withLock } = await import("@/lib/locks");
  const { runRecommendationSweep } = await import(
    "@/lib/recommendations/recommendationTracker"
  );
  const outcome = await withLock("cron:recommendation-sweep", SWEEP_LOCK_MS, () =>
    runRecommendationSweep({
      logger: log,
      silentAlerts: (process.env.RECOMMENDATION_ALERTS_SILENT ?? "").trim() === "1",
    }),
  );
  if (outcome.ran) {
    state.sweepLastRunAt = Date.now();
    state.sweepLastError = null;
  }
}

function safeTick(name: "warm" | "sweep", tick: () => Promise<void>): void {
  tick().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (name === "warm") state.warmLastError = message;
    else state.sweepLastError = message;
    log.warn(`${name} tick failed`, { error: message });
  });
}

/**
 * Idempotent process-wide start. Survives HMR re-registration in dev via a
 * globalThis marker; timers are unref'd so they never hold the process open.
 */
export function startInternalScheduler(): void {
  const marker = globalThis as typeof globalThis & {
    __aichartInternalScheduler?: boolean;
  };
  if (marker.__aichartInternalScheduler) return;
  if (!schedulerEnabled()) {
    log.info("internal scheduler disabled");
    return;
  }
  marker.__aichartInternalScheduler = true;
  state.enabled = true;
  state.startedAt = Date.now();

  const warmTimer = setInterval(() => safeTick("warm", warmTick), WARM_INTERVAL_MS);
  const sweepTimer = setInterval(
    () => safeTick("sweep", sweepTick),
    SWEEP_INTERVAL_MS,
  );
  if (typeof warmTimer.unref === "function") warmTimer.unref();
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  // Kick a first pass shortly after boot so a restarted VPS heals quickly
  // instead of waiting a full interval with a cold warehouse.
  const bootTimer = setTimeout(() => {
    safeTick("warm", warmTick);
    safeTick("sweep", sweepTick);
  }, 15_000);
  if (typeof bootTimer.unref === "function") bootTimer.unref();

  log.info("internal scheduler started", {
    warmEveryMs: WARM_INTERVAL_MS,
    sweepEveryMs: SWEEP_INTERVAL_MS,
  });
}
