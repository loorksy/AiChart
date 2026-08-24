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
  // Must stay ABOVE the OHLC provider's per-request timeout. The old 10s budget
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
  // Sized from measurement, and the measurement was redone on 2026-08-24.
  // The old 95s came from a 2026-07-30 probe of 29-38s calls — but those were
  // being truncated at the then-current output ceiling, so the probe timed a
  // cut-off answer. With DECISION_OUTPUT_TOKENS raised to 12000 the model
  // actually finishes, and a complete Arabic decision measured 84.5s / 4739
  // output tokens (~56 tok/s) against claude-sonnet-4-6. 95s could not hold
  // even one such attempt, so every live analysis died on the stage deadline.
  // 215s holds TWO full attempts (105s cap each) plus the 700ms pause, which is
  // what the retry loop promises: a truncated or schema-mismatched reply gets a
  // real second chance instead of being killed mid-generation.
  finalDecision: 215_000,
  general: 20_000,
} as const;

/**
 * Total wall-clock budget for one direct agent run (RELIABILITY_PLAN.md item 2).
 *
 * It must stay BELOW the MCP tool's wait so the caller receives a real
 * three-state envelope instead of a transport timeout with no result, and the
 * web route's own `maxDuration` stays above BOTH, leaving room to compose and
 * send the final event after the budget trips. The ordering is the invariant:
 *   stage budgets  <  TOTAL_RUN_BUDGET_MS  <  MCP_ANALYZE_TIMEOUT_MS  <  maxDuration
 *
 * Raised on 2026-08-24 with finalDecision (95→215s), because a complete Arabic
 * decision measures ~85s of generation and the old chain could not hold even one,
 * let alone the retry the loop promises.
 *
 * The worst serial chain, counted in full:
 *   28 (marketData) + 8 (fleet) + 5 (risk) + 11 (visual) + 215 (final)
 *   + 5 (drawing) = 272s
 *
 * The visual stage is the term this sum used to omit, and omitting it is what
 * left the budget with no headroom at all while the comment claimed 9s of it.
 * It is serial — awaited between the macro/COT block and the decision — and
 * it costs the image budget PLUS a loopback hop, because an analysis running
 * in the worker cannot capture in its own process and delegates the capture to
 * the web process over HTTP (see `agent/visualEvidence.ts`). Measured live on
 * 2026-08-24: three real TradingView frames in 8.86s, against a 9s image
 * budget and an 11s wall. So 11s is the term, not 9.
 *
 * 275s keeps the invariant with the 3s of slack the old arithmetic only
 * appeared to have.
 */
export const TOTAL_RUN_BUDGET_MS = 275_000;

/** MCP's client-side wait for run_market_analysis — the ceiling we stay under. */
export const MCP_ANALYZE_TIMEOUT_MS = 285_000;

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
