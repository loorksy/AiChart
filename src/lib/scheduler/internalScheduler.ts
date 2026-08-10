import { createLogger } from "@/lib/logger";

const log = createLogger("scheduler.internal");

/**
 * In-process fallback scheduler for long-lived (VPS / standalone) deployments.
 *
 * The platform's freshness pipeline assumes something is regularly sweeping
 * tracked recommendations (`/api/cron/recommendation-sweep`, every 5 min). On
 * a VPS that only runs if the operator installed `/etc/cron.d/aichart` with
 * the right domain + CRON_SECRET — and when that's missing or wrong,
 * conditional recommendations are NEVER evaluated, which reads to the user as
 * "my condition happened and the agent did nothing".
 *
 * This scheduler removes that external dependency: plain `setInterval` inside
 * the Next.js node process, with each tick funneled through the same
 * distributed `withLock` lease the cron route uses, so external cron (if
 * installed) and multiple replicas never double-run work.
 *
 * Enabled when `INTERNAL_SCHEDULER=1` (recommended on VPS) or by default when
 * not on Vercel serverless (long-lived process detected). Disable explicitly
 * with `INTERNAL_SCHEDULER=0`.
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SWEEP_LOCK_MS = 290_000;

export interface InternalSchedulerStatus {
  enabled: boolean;
  startedAt: number | null;
  sweepLastRunAt: number | null;
  sweepLastError: string | null;
}

/**
 * State lives on globalThis, NOT at module level: Next.js compiles the
 * instrumentation hook and API routes into separate module graphs, so a
 * module-level object here would exist twice — the scheduler would write to
 * one instance while /api/healthz reads the other and forever reports
 * `enabled: false`. One process ⇒ one shared status object.
 */
const globalState = globalThis as typeof globalThis & {
  __aichartInternalSchedulerState?: InternalSchedulerStatus;
};
const state: InternalSchedulerStatus = (globalState.__aichartInternalSchedulerState ??= {
  enabled: false,
  startedAt: null,
  sweepLastRunAt: null,
  sweepLastError: null,
});

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

function safeTick(name: "sweep", tick: () => Promise<void>): void {
  tick().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    state.sweepLastError = message;
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

  const sweepTimer = setInterval(
    () => safeTick("sweep", sweepTick),
    SWEEP_INTERVAL_MS,
  );
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  // Kick a first pass shortly after boot so a restarted VPS heals quickly.
  const bootTimer = setTimeout(() => {
    safeTick("sweep", sweepTick);
  }, 15_000);
  if (typeof bootTimer.unref === "function") bootTimer.unref();

  log.info("internal scheduler started", {
    sweepEveryMs: SWEEP_INTERVAL_MS,
  });
}
