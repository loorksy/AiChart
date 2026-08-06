/**
 * Run-stage events — the structured "what is the agent doing right now"
 * protocol (docs/PLATFORM_AGENT_UPGRADE_PLAN.md Phase 3.1).
 *
 * The orchestrator already runs a named fleet (market_data → structure /
 * liquidity / supply_demand / multi_timeframe → news → risk → final_decision);
 * these events surface that existing shape to the client as a live checklist
 * instead of a single collapsing ticker line. Payloads carry stage NAMES and
 * durations only — never evidence, never reasoning.
 */

export type AgentStageEventStatus =
  | "running"
  | "done"
  | "failed"
  /** Served from the stage checkpoint — real evidence, no re-computation. */
  | "resumed";

export interface AgentStageEvent {
  /** AgentStage name from errorTaxonomy (kept as string for wire tolerance). */
  stage: string;
  status: AgentStageEventStatus;
  durationMs?: number;
  timestamp: number;
}

export interface AggregatedStage {
  stage: string;
  status: AgentStageEventStatus;
  durationMs: number | null;
}

/**
 * Collapse a run's event list into one row per stage, ordered by first
 * appearance. Later events win (running → done/failed), and a terminal status
 * is never demoted back to running by a late duplicate.
 */
export function aggregateStageEvents(
  events: readonly AgentStageEvent[],
): AggregatedStage[] {
  const order: string[] = [];
  const byStage = new Map<string, AggregatedStage>();
  for (const event of events) {
    if (!event || typeof event.stage !== "string" || !event.stage) continue;
    let row = byStage.get(event.stage);
    if (!row) {
      row = { stage: event.stage, status: event.status, durationMs: null };
      byStage.set(event.stage, row);
      order.push(event.stage);
    } else if (!(event.status === "running" && row.status !== "running")) {
      // Later events win — except a stray "running" never demotes a settled row.
      row.status = event.status;
    }
    if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
      row.durationMs = Math.max(0, Math.round(event.durationMs));
    }
  }
  return order.map((stage) => byStage.get(stage)!);
}
