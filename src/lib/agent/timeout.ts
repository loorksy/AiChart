/**
 * Per-agent timeout wrappers.
 *
 * `withTimeout` is the legacy racer: it returns a fallback on deadline but
 * leaves the underlying promise running. It is still correct for purely
 * COMPUTATIONAL stages (the structure/liquidity/supply-demand/MTF specialists
 * do no I/O), where an orphaned promise costs nothing but CPU already spent.
 *
 * `withDeadline` is the cancelling variant required for I/O stages
 * (RELIABILITY_PLAN.md item 2): it hands the work an AbortSignal and ALWAYS
 * aborts it when the deadline hits, when the parent run is cancelled, or when
 * the caller stops waiting — so a timed-out provider call is actually torn
 * down instead of quietly finishing after the user already got a fallback.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run `work` under a real deadline. The signal passed to `work` aborts when:
 * the deadline elapses, `parentSignal` aborts, or the wrapper settles.
 *
 * On deadline the fallback is returned (same contract as `withTimeout`, so the
 * orchestrator's partial-result rules are unchanged) — but the abort is fired
 * first, so the underlying request stops. A thrown AbortError caused by our own
 * deadline is swallowed into the fallback; any other error propagates.
 */
export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T,
  parentSignal?: AbortSignal,
): Promise<T> {
  // Already cancelled before we start: never spend a provider call on a run
  // whose result nobody is waiting for.
  if (parentSignal?.aborted) return fallback;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  // Resolves as soon as WE cancel (deadline or parent). Racing on this — rather
  // than on the work promise alone — means an uncooperative stage that ignores
  // its signal still cannot hold the run past its deadline.
  const cancelled = new Promise<typeof DEADLINE_HIT>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(DEADLINE_HIT), {
      once: true,
    });
  });

  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const result = await Promise.race([
      work(controller.signal).catch((err) => {
        // An abort WE caused (deadline or parent cancel) is not a real fault:
        // degrade to the fallback exactly like the legacy racer did.
        if (controller.signal.aborted) return DEADLINE_HIT;
        throw err;
      }),
      cancelled,
    ]);
    return result === DEADLINE_HIT ? fallback : (result as T);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
    // Always tear down: covers the deadline path AND a caller that stopped
    // waiting for any other reason. Aborting a settled op is a no-op.
    controller.abort();
  }
}

const DEADLINE_HIT = Symbol("deadline");

/** Suggested per-agent deadlines (ms). If Risk times out → decision must be wait. */
export const AGENT_TIMEOUTS = {
  // Must stay ABOVE MetaApi's HISTORY_TIMEOUT_MS (12s). The old 10s budget
  // made every cold/live history pull a structural timeout — a single page
  // race already outlived the whole market-data stage, so operators saw
  // "بيانات السوق لم تنتهِ ضمن المهلة" on first analysis after restart and
  // on any thin-warehouse symbol. 28s fits one page timeout + one retry
  // (or a slow warm connect) without crowding the final-decision budget.
  marketData: 28_000,
  structure: 5_000,
  liquidity: 5_000,
  supplyDemand: 5_000,
  multiTimeframe: 5_000,
  news: 8_000,
  risk: 5_000,
  drawing: 5_000,
  // gpt-5 family spends budget on reasoning before emitting JSON; 15s was
  // aborting live XAUUSD decisions before any recommendation could land.
  // Chart capture waits on the operator's MT5 or a render service. Bounded
  // tightly: a missing view costs the decision some context, a slow one would
  // cost it the whole run.
  visualEvidence: 9_000,
  // Sized from measurement, not hope: single deep-tier calls on live XAUUSD
  // run 29-38s (probe of 2026-07-30), and the loop above promises ONE retry.
  // 60s structurally forbade that retry — attempt 2 was always killed mid-
  // flight and the operator saw a generic timeout instead of the real fault.
  // 95s fits two worst-case attempts plus the 700ms pause, and stays inside
  // TOTAL_RUN_BUDGET_MS with the earlier stages' worst case.
  finalDecision: 95_000,
  general: 20_000,
} as const;

/**
 * Total wall-clock budget for one direct agent run (RELIABILITY_PLAN.md item 2).
 *
 * It must stay BELOW the MCP tool's 150s wait so the caller receives a real
 * three-state envelope instead of a transport timeout with no result. The web
 * route's own `maxDuration` (180s) stays above this, leaving room to compose
 * and send the final event after the budget trips.
 *
 * Raised with marketData (10→28s) so the worst serial chain still fits:
 * 28 + 8 (fleet) + 5 (risk) + 95 (final) + 5 (drawing) = 141s < 145s.
 */
export const TOTAL_RUN_BUDGET_MS = 145_000;

/** MCP's client-side wait for run_market_analysis — the ceiling we stay under. */
export const MCP_ANALYZE_TIMEOUT_MS = 150_000;

export interface RunBudget {
  /** Signal every I/O stage links to: aborts on client cancel OR budget end. */
  signal: AbortSignal;
  /** True once the total budget elapsed (as opposed to a client cancel). */
  readonly expired: boolean;
  /** True when the CLIENT cancelled (not our budget). */
  readonly cancelledByClient: boolean;
  /** Milliseconds left in the budget (0 once spent). */
  remainingMs(): number;
  /** Release the timer. Always call in a finally. */
  dispose(): void;
}

/**
 * Create the run-level budget for one agent run (RELIABILITY_PLAN.md item 2).
 * Linking every I/O stage to `signal` means a blown budget or a disconnected
 * client actually tears provider work down instead of leaving it running
 * behind a request nobody is waiting for.
 */
export function createRunBudget(
  clientSignal?: AbortSignal,
  totalMs: number = TOTAL_RUN_BUDGET_MS,
  now: () => number = Date.now,
): RunBudget {
  const startedAt = now();
  const controller = new AbortController();
  let expired = false;

  const onClientAbort = () => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) controller.abort();
    else clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, totalMs);
  // Never hold the process open just for the budget timer.
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    signal: controller.signal,
    get expired() {
      return expired;
    },
    get cancelledByClient() {
      return Boolean(clientSignal?.aborted) && !expired;
    },
    remainingMs() {
      return Math.max(0, totalMs - (now() - startedAt));
    },
    dispose() {
      clearTimeout(timer);
      clientSignal?.removeEventListener("abort", onClientAbort);
    },
  };
}
