/**
 * Prometheus metrics. A single process-wide registry (stashed on globalThis so
 * Next.js HMR / repeated imports never double-register a metric and throw).
 * Scraped at GET /api/metrics. Instrument the hot paths: cron cycles, queue
 * jobs, agent runs, technical execution denials, executed trades, broker connectivity.
 */
import client from "prom-client";

type Store = {
  registry: client.Registry;
  cronDuration: client.Histogram<string>;
  jobs: client.Counter<string>;
  agentRuns: client.Counter<string>;
  executionDenials: client.Counter<string>;
  /** Re-evaluation cycles started, by what triggered them. */
  reevaluationCycles: client.Counter<string>;
  /** What those cycles concluded: confirmed | revised | invalidated. */
  reevaluationVerdicts: client.Counter<string>;
  /** Moments where both surfaces decided and were compared. */
  parityComparisons: client.Gauge<string>;
  /** Differences with no known cause. Completion criterion 2 requires zero. */
  parityUnexplained: client.Gauge<string>;
  tradesExecuted: client.Counter<string>;
  brokerUp: client.Gauge<string>;
  // --- Reliability metrics (RELIABILITY_PLAN.md item 9) ---
  outcomes: client.Counter<string>;
  stageFailures: client.Counter<string>;
  stageTimeouts: client.Counter<string>;
  providerErrors: client.Counter<string>;
  providerRetries: client.Counter<string>;
  circuitState: client.Gauge<string>;
  requestsWithoutFinal: client.Counter<string>;
  runDuration: client.Histogram<string>;
  eventLoopLag: client.Gauge<string>;
};

const g = globalThis as unknown as { __aichartMetrics?: Store };

function build(): Store {
  const registry = new client.Registry();
  registry.setDefaultLabels({ app: "aichart" });
  client.collectDefaultMetrics({ register: registry });

  const cronDuration = new client.Histogram({
    name: "aichart_cron_duration_seconds",
    help: "Duration of a cron cycle by job",
    labelNames: ["job"],
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
    registers: [registry],
  });
  const jobs = new client.Counter({
    name: "aichart_jobs_total",
    help: "Background jobs processed by name and status",
    labelNames: ["name", "status"],
    registers: [registry],
  });
  const agentRuns = new client.Counter({
    name: "aichart_agent_runs_total",
    help: "Agent runs by mode and status",
    labelNames: ["mode", "status"],
    registers: [registry],
  });
  const parityComparisons = new client.Gauge({
    name: "aichart_parity_comparisons",
    help: "Platform/MCP decisions compared on identical evidence",
    registers: [registry],
  });
  const parityUnexplained = new client.Gauge({
    name: "aichart_parity_unexplained",
    help: "Platform/MCP differences with no known cause (target: 0)",
    registers: [registry],
  });
  const reevaluationCycles = new client.Counter({
    name: "aichart_reevaluation_cycles_total",
    help: "Re-evaluation decision cycles started, by trigger reason",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  const reevaluationVerdicts = new client.Counter({
    name: "aichart_reevaluation_verdicts_total",
    help: "Re-evaluation outcomes — confirmed is as important as revised",
    labelNames: ["verdict"] as const,
    registers: [registry],
  });
  const executionDenials = new client.Counter({
    name: "aichart_execution_denials_total",
    help: "Technical execution denials by structured deny code",
    labelNames: ["code"],
    registers: [registry],
  });
  const tradesExecuted = new client.Counter({
    name: "aichart_trades_executed_total",
    help: "Executed trades by broker and market",
    labelNames: ["broker", "market"],
    registers: [registry],
  });
  const brokerUp = new client.Gauge({
    name: "aichart_broker_up",
    help: "Broker/bridge connectivity (1=up, 0=down) by kind",
    labelNames: ["kind"],
    registers: [registry],
  });

  // --- Reliability metrics (RELIABILITY_PLAN.md item 9) ------------------
  // The headline ratio: every direct request ends in exactly one of the three
  // states. A rising operational_blocker share is the outage signal.
  const outcomes = new client.Counter({
    name: "aichart_agent_outcomes_total",
    help: "Agent runs by three-state outcome class and execution mode",
    labelNames: ["outcome", "execution_mode", "failure_code"],
    registers: [registry],
  });
  const stageFailures = new client.Counter({
    name: "aichart_agent_stage_failures_total",
    help: "Classified agent stage failures by stage and taxonomy code",
    labelNames: ["stage", "code", "retryable"],
    registers: [registry],
  });
  const stageTimeouts = new client.Counter({
    name: "aichart_agent_stage_timeouts_total",
    help: "Agent stages that hit their deadline, by stage",
    labelNames: ["stage"],
    registers: [registry],
  });
  const providerErrors = new client.Counter({
    name: "aichart_provider_errors_total",
    help: "Outbound provider failures by provider and class (429/5xx/network)",
    labelNames: ["provider", "kind"],
    registers: [registry],
  });
  // Retry SUCCESS rate: outcome="succeeded" over all retry attempts.
  const providerRetries = new client.Counter({
    name: "aichart_provider_retries_total",
    help: "Provider retry attempts by provider and outcome",
    labelNames: ["provider", "outcome"],
    registers: [registry],
  });
  const circuitState = new client.Gauge({
    name: "aichart_provider_circuit_state",
    help: "Circuit breaker state per provider (0=closed, 1=half_open, 2=open)",
    labelNames: ["provider"],
    registers: [registry],
  });
  // PHASE-0 SLO: this counter must stay at zero. Any increment is a request
  // that ended without a complete `final` event.
  const requestsWithoutFinal = new client.Counter({
    name: "aichart_requests_without_final_total",
    help: "SLO breach: requests that ended without a complete final event",
    labelNames: ["route", "reason"],
    registers: [registry],
  });
  const runDuration = new client.Histogram({
    name: "aichart_agent_run_duration_seconds",
    help: "End-to-end agent run duration by outcome",
    labelNames: ["outcome"],
    buckets: [1, 2, 5, 10, 20, 30, 45, 60, 90, 120, 150],
    registers: [registry],
  });
  const eventLoopLag = new client.Gauge({
    name: "aichart_event_loop_lag_seconds",
    help: "Event loop lag — rises when heavy sync work starves the loop",
    registers: [registry],
  });

  return {
    registry,
    cronDuration,
    jobs,
    agentRuns,
    executionDenials,
    reevaluationCycles,
    reevaluationVerdicts,
    parityComparisons,
    parityUnexplained,
    tradesExecuted,
    brokerUp,
    outcomes,
    stageFailures,
    stageTimeouts,
    providerErrors,
    providerRetries,
    circuitState,
    requestsWithoutFinal,
    runDuration,
    eventLoopLag,
  };
}

export const metrics: Store = (g.__aichartMetrics ??= build());

/** Render the Prometheus exposition text. */
export async function renderMetrics(): Promise<string> {
  return metrics.registry.metrics();
}

// --- Reliability recording helpers -------------------------------------------
// Thin, total functions so instrumentation at a call site is one line and can
// never throw into the request path (a metrics bug must not break a trade).

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* metrics must never break the caller */
  }
}

/** Record the terminal three-state outcome of an agent run. */
export function recordAgentOutcome(input: {
  outcome: string;
  executionMode?: string;
  failureCode?: string;
  durationSeconds?: number;
}): void {
  safely(() => {
    metrics.outcomes.inc({
      outcome: input.outcome,
      execution_mode: input.executionMode ?? "descriptive",
      failure_code: input.failureCode ?? "none",
    });
    if (typeof input.durationSeconds === "number") {
      metrics.runDuration.observe({ outcome: input.outcome }, input.durationSeconds);
    }
  });
}

/** Record a classified stage failure (and its deadline flavour separately). */
export function recordStageFailure(input: {
  stage: string;
  code: string;
  retryable: boolean;
}): void {
  safely(() => {
    metrics.stageFailures.inc({
      stage: input.stage,
      code: input.code,
      retryable: String(input.retryable),
    });
    if (input.code === "timeout") {
      metrics.stageTimeouts.inc({ stage: input.stage });
    }
  });
}

/** Record an outbound provider failure by class. */
export function recordProviderError(provider: string, kind: string): void {
  safely(() => metrics.providerErrors.inc({ provider, kind }));
}

/** Record a retry attempt outcome — the numerator/denominator of retry success. */
export function recordProviderRetry(provider: string, outcome: "succeeded" | "failed"): void {
  safely(() => metrics.providerRetries.inc({ provider, outcome }));
}

const CIRCUIT_VALUE: Record<string, number> = { closed: 0, half_open: 1, open: 2 };

export function recordCircuitState(provider: string, state: string): void {
  safely(() => metrics.circuitState.set({ provider }, CIRCUIT_VALUE[state] ?? 0));
}

/** SLO breach: a request that ended without a complete final event. */
export function recordRequestWithoutFinal(route: string, reason: string): void {
  safely(() => metrics.requestsWithoutFinal.inc({ route, reason }));
}

/**
 * Sample event-loop lag. Heavy synchronous work (the research-service incident
 * pattern) shows up here before users notice, so it is worth one cheap timer.
 */
export function startEventLoopLagSampler(intervalMs = 5_000): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const started = process.hrtime.bigint();
    setTimeout(() => {
      if (stopped) return;
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      safely(() => metrics.eventLoopLag.set(Math.max(0, elapsedMs - intervalMs) / 1000));
      tick();
    }, intervalMs).unref?.();
  };
  tick();
  return () => {
    stopped = true;
  };
}
