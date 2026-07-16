/**
 * Per-agent timeout wrapper. Every specialist agent runs under a deadline so a
 * hung provider/tool degrades to a safe fallback instead of stalling the whole
 * request. On timeout the fallback value is returned (never a throw), so the
 * orchestrator's partial-result rules stay in control.
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

/** Suggested per-agent deadlines (ms). If Risk times out → decision must be wait. */
export const AGENT_TIMEOUTS = {
  marketData: 10_000,
  structure: 5_000,
  liquidity: 5_000,
  supplyDemand: 5_000,
  multiTimeframe: 5_000,
  news: 8_000,
  risk: 5_000,
  drawing: 5_000,
  // gpt-5 family spends budget on reasoning before emitting JSON; 15s was
  // aborting live XAUUSD decisions before any recommendation could land.
  finalDecision: 60_000,
  general: 20_000,
} as const;
