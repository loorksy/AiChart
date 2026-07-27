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
  /** Detected trigger admission outcomes: admitted | suppressed | duplicate. */
  reevaluationTriggers: client.Counter<string>;
  /** What those cycles concluded: confirmed | revised | invalidated. */
  reevaluationVerdicts: client.Counter<string>;
  /** Moments where both surfaces decided and were compared. */
  parityComparisons: client.Gauge<string>;
  /** Comparable Platform/MCP decisions whose contract fields differ. */
  parityDifferences: client.Gauge<string>;
  /** Differences with no known cause. Completion criterion 2 requires zero. */
  parityUnexplained: client.Gauge<string>;
  // --- Plan §17 dashboards ---
  /** Successful analyses that produced the full three-layer contract vs not. */
  analysisContracts: client.Counter<string>;
  /** CRITICAL: attempts to WRITE a new analytical WAIT. Target: zero, forever. */
  hiddenWaitWrites: client.Counter<string>;
  /** Recommendations that arrived without valid levels. */
  invalidLevelRecommendations: client.Counter<string>;
  recommendationPersistFailures: client.Counter<string>;
  /** CRITICAL: an order attempt without valid mode/authorisation. */
  executionInWrongMode: client.Counter<string>;
  /** stale_revision denials — existence is health, a spike is a race alarm. */
  staleRevisionDenials: client.Counter<string>;
  /** Duplicate notification suppressions (dedupe working = these grow, sends do not). */
  duplicateNotifications: client.Counter<string>;
  /** Planned net R after costs, per successful plan. */
  plannedNetR: client.Histogram<string>;
  /** Decision latency with/without vision, seconds. */
  visionLatency: client.Histogram<string>;
  /** Serialized evidence-snapshot size in bytes. */
  evidenceSnapshotBytes: client.Histogram<string>;
  /** Case-memory rows by state (resolved/pending) — set by the indexer cron. */
  caseMemoryRows: client.Gauge<string>;
  /** Extra-frame second rounds requested / completed / failed. */
  extraFrameRounds: client.Counter<string>;
  /** Age in seconds of the freshest live cost-profile sample per symbol. */
  costProfileFreshness: client.Gauge<string>;
  /** Critical alerts raised, by kind — any nonzero value is a page. */
  criticalAlerts: client.Counter<string>;
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
  const parityDifferences = new client.Gauge({
    name: "aichart_parity_differences",
    help: "Platform/MCP decisions with one or more differing contract fields",
    registers: [registry],
  });
  const parityUnexplained = new client.Gauge({
    name: "aichart_parity_unexplained",
    help: "Platform/MCP differences with no known cause (target: 0)",
    registers: [registry],
  });
  const analysisContracts = new client.Counter({
    name: "aichart_analysis_contracts_total",
    help: "Successful analyses by contract completeness (complete|incomplete)",
    labelNames: ["completeness"],
    registers: [registry],
  });
  const hiddenWaitWrites = new client.Counter({
    name: "aichart_hidden_wait_writes_total",
    help: "Attempts to write a new analytical WAIT (critical, target 0)",
    labelNames: ["source"],
    registers: [registry],
  });
  const invalidLevelRecommendations = new client.Counter({
    name: "aichart_invalid_level_recommendations_total",
    help: "Buy/sell recommendations arriving without valid levels",
    labelNames: ["source"],
    registers: [registry],
  });
  const recommendationPersistFailures = new client.Counter({
    name: "aichart_recommendation_persist_failures_total",
    help: "Plans answered to the operator but never stored (target 0)",
    labelNames: ["surface"],
    registers: [registry],
  });
  const executionInWrongMode = new client.Counter({
    name: "aichart_execution_wrong_mode_total",
    help: "Order attempts without valid mode/authorisation (critical, target 0)",
    labelNames: ["source"],
    registers: [registry],
  });
  const staleRevisionDenials = new client.Counter({
    name: "aichart_stale_revision_denials_total",
    help: "Executions refused because the plan was superseded",
    registers: [registry],
  });
  const duplicateNotifications = new client.Counter({
    name: "aichart_duplicate_notifications_total",
    help: "Notification sends suppressed by the dedupe key",
    registers: [registry],
  });
  const plannedNetR = new client.Histogram({
    name: "aichart_planned_net_r",
    help: "Planned net R after modelled costs, per successful plan",
    buckets: [0.5, 1, 1.5, 2, 2.5, 3, 4, 6],
    registers: [registry],
  });
  const visionLatency = new client.Histogram({
    name: "aichart_vision_latency_seconds",
    help: "Decision latency by whether chart images were attached",
    labelNames: ["vision"],
    buckets: [2, 5, 10, 20, 30, 45, 60, 90],
    registers: [registry],
  });
  const evidenceSnapshotBytes = new client.Histogram({
    name: "aichart_evidence_snapshot_bytes",
    help: "Serialized evidence snapshot size per revision",
    buckets: [512, 2048, 8192, 32768, 131072, 524288],
    registers: [registry],
  });
  const caseMemoryRows = new client.Gauge({
    name: "aichart_case_memory_rows",
    help: "Indexed market cases by state",
    labelNames: ["state"],
    registers: [registry],
  });
  const extraFrameRounds = new client.Counter({
    name: "aichart_extra_frame_rounds_total",
    help: "Second-round timeframe requests by outcome",
    labelNames: ["outcome"],
    registers: [registry],
  });
  const costProfileFreshness = new client.Gauge({
    name: "aichart_cost_profile_freshness_seconds",
    help: "Age of the freshest live cost sample per symbol",
    labelNames: ["symbol"],
    registers: [registry],
  });
  const criticalAlerts = new client.Counter({
    name: "aichart_critical_alerts_total",
    help: "Critical invariant violations — any nonzero value is a page",
    labelNames: ["kind"],
    registers: [registry],
  });
  const reevaluationCycles = new client.Counter({
    name: "aichart_reevaluation_cycles_total",
    help: "Re-evaluation decision cycles started, by trigger reason",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  const reevaluationTriggers = new client.Counter({
    name: "aichart_reevaluation_triggers_total",
    help: "Re-evaluation triggers by reason and durable claim outcome",
    labelNames: ["reason", "outcome"] as const,
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
    reevaluationTriggers,
    reevaluationVerdicts,
    parityComparisons,
    parityDifferences,
    parityUnexplained,
    analysisContracts,
    hiddenWaitWrites,
    invalidLevelRecommendations,
    recommendationPersistFailures,
    executionInWrongMode,
    staleRevisionDenials,
    duplicateNotifications,
    plannedNetR,
    visionLatency,
    evidenceSnapshotBytes,
    caseMemoryRows,
    extraFrameRounds,
    costProfileFreshness,
    criticalAlerts,
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

/**
 * A critical alert is an INVARIANT violation, not a bad day: a new analytical
 * WAIT reaching a write path, an order attempt outside the authorised mode, a
 * plan edit outside the revision mechanism. Each increments its counter and logs
 * at error level so any alerting stack pages on it — the correct steady-state
 * count for every kind is zero.
 */
export function criticalAlert(
  kind: "hidden_wait_write" | "execution_wrong_mode" | "plan_edit_outside_revisions" | "unexplained_parity",
  detail: Record<string, unknown> = {},
): void {
  metrics.criticalAlerts.inc({ kind });
  // The diagnostics dashboard reads the PER-KIND series as well as the roll-up
  // (aichart_hidden_wait_writes_total, aichart_execution_wrong_mode_total).
  // Incrementing only the roll-up left those panels reading zero while a
  // critical alert was firing — the one place an operator would look to see it.
  // Done here, in the function that already knows the kind, so a new call site
  // cannot forget half of it.
  const source = typeof detail.source === "string" ? detail.source : "unknown";
  if (kind === "hidden_wait_write") metrics.hiddenWaitWrites.inc({ source });
  if (kind === "execution_wrong_mode") metrics.executionInWrongMode.inc({ source });
  // eslint-disable-next-line no-console
  console.error(`[CRITICAL] ${kind}`, JSON.stringify(detail));
}
