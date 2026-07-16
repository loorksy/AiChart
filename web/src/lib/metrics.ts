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
  tradesExecuted: client.Counter<string>;
  brokerUp: client.Gauge<string>;
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

  return {
    registry,
    cronDuration,
    jobs,
    agentRuns,
    executionDenials,
    tradesExecuted,
    brokerUp,
  };
}

export const metrics: Store = (g.__aichartMetrics ??= build());

/** Render the Prometheus exposition text. */
export async function renderMetrics(): Promise<string> {
  return metrics.registry.metrics();
}
