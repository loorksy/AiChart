/**
 * Feature flags so the Smart Chart Agent + Candle Warehouse roll out gradually
 * without breaking the existing platform. A disabled feature returns a safe
 * fallback (old path), never a crash.
 *
 * Read via functions (not a frozen const) so operator-set env / platform config
 * takes effect without a rebuild, matching the rest of the codebase.
 */
import { getPlatformValue } from "@/lib/platformConfig";

function flag(name: string, defaultOn: boolean): boolean {
  const raw = (getPlatformValue(name) ?? process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return defaultOn;
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

export const FEATURES = {
  /** The docked Smart Chart Agent chat + unified orchestrator. ON by default. */
  /** Warehouse-first /api/market/klines reads. ON by default. */
  candleWarehouse: () => flag("FEATURE_CANDLE_WAREHOUSE", true),
  /** News & Macro Risk agent participation. */
  /** Execution Guard — ON by default; only an explicit "false" disables it. */
  /** Route MCP run_market_analysis through the unified engine. ON by default. */
  /** Intent-based skill discovery + lazy loading into agent prompts. ON by
   *  default — read-only prompt guidance that never grants permissions. */
  agentSkillsV1: () => flag("FEATURE_AGENT_SKILLS", true),
  /** Bounded persisted conversation context. ON by default (optional aid —
   *  failure degrades to the legacy contextless path, never blocks a run). */
  agentContextV2: () => flag("AGENT_CONTEXT_V2", true),
  /** Conservative memory candidate writes. OFF until explicit rollout. */
  agentMemoryWriteV1: () => flag("AGENT_MEMORY_WRITE_V1", false),
  /** Chart images in the decision call, so the platform engine sees what the
   *  MCP agent sees. ON by default; disabling returns the numbers-only read. */
  visionDecisionV1: () => flag("VISION_DECISION_V1", true),
  /** Redacted run/step/tool-call persistence. ON by default so selected
   *  skills/tools/routing are auditable; failure never blocks a run. */
  agentRunTraceV1: () => flag("AGENT_RUN_TRACE_V1", true),
  /** Historical case memory in the evidence bundle. ON by default: an empty
   *  memory contributes an explicit "no comparable history", which is the
   *  honest answer either way. */
  caseMemoryV1: () => flag("CASE_MEMORY_V1", true),

  // ─── Unified-agent phase flags (docs/UNIFIED_AGENT_IMPLEMENTATION_PLAN.md §5) ───
  //
  // One flag per phase, each with a stated rollback. The plan's rollback
  // mechanism is "turn the flag off" — a phase with no flag cannot be rolled
  // back, which is why these exist even where the phase is safe.
  //
  // A flag gates the phase's OWN behaviour only. None of them gates READING
  // data the phase wrote: turning a flag off must never make stored rows
  // unreadable, or rollback would lose history.

  /**
   * Phase A — three-layer doctrine. ON by default and intended to stay on: the
   * doctrine is the product.
   *
   * OFF is a narrow escape hatch for a decision model that cannot satisfy the
   * contract: the synthesizer keeps the three layers (they are structural) but
   * the API stops REFUSING a `wait` write, so an MCP client that has not been
   * updated can still record something rather than failing every call. It does
   * not resurrect WAIT inside the engine.
   */
  agentDoctrineV3: () => flag("AGENT_DOCTRINE_V3", true),

  /**
   * Tradability gate (docs/PLATFORM_AGENT_UPGRADE_PLAN.md Phase 1). ON by
   * default: the externally reachable recommendation write path refuses plans
   * whose entry is beyond the publishable distance budget, instead of storing
   * them as normal conditional trades.
   *
   * OFF stops REFUSING only — the assessment is still computed, persisted in
   * the context blob, and returned to the caller, so rollback loses the gate
   * but never the measurement.
   */
  tradabilityGateV1: () => flag("TRADABILITY_GATE_V1", true),

  /**
   * Phase B — effective revisions. ON by default.
   *
   * OFF stops SEEDING new revisions and stops the compare-and-swap denial on
   * execution. Existing revisions stay readable and the append-only history is
   * untouched; a recommendation created while off simply has no effective
   * revision, which makes it ineligible for auto-execution — the safe direction.
   */
  recRevisionsV1: () => flag("REC_REVISIONS_V1", true),

  /**
   * Phase C — lifecycle notifications. ON by default.
   *
   * OFF returns the pre-phase silence: events are still DERIVED and recorded,
   * only delivery stops. Distinct from RECOMMENDATION_ALERTS_SILENT, which is a
   * temporary launch mode rather than a phase rollback.
   */
  recLifecycleAlertsV1: () => flag("REC_LIFECYCLE_ALERTS_V1", true),

  /**
   * Phase D — trade modes and automatic execution. ON by default for the mode
   * STATE only; automatic order placement has its own separate staging in
   * AUTO_EXECUTION_STAGE, which defaults to off.
   *
   * OFF forces every operator to advisory regardless of what they stored, and
   * denies any standing_auto intent. The stored mode is preserved so turning the
   * flag back on does not lose the operator's choice.
   */
  agentTradeModeV1: () => flag("AGENT_TRADE_MODE_V1", true),

  /**
   * Phase F — Pattern Atlas and the extended detectors. ON by default.
   *
   * OFF stops loading atlas skill entries and stops emitting pattern-boundary
   * candidates. The deterministic geometry engine keeps running: its output is
   * evidence the rest of the system already depended on.
   */
  patternAtlasV1: () => flag("PATTERN_ATLAS_V1", true),

  /**
   * Phase H — session costs and prepared statistical evidence. ON by default.
   *
   * OFF falls back to the single observed spread with no session shaping, and to
   * no statistical-support grade (reported as `unavailable`, never as a guess).
   */
  evidencePipelineV2: () => flag("EVIDENCE_PIPELINE_V2", true),

  /**
   * Phase I — deep research producing verdicts and revisions. ON by default.
   *
   * OFF returns deep research to reporting only: it still runs and still records
   * its findings, but proposes no revision. Nothing silently edits a plan either
   * way — that is structural, not flagged.
   */
  deepResearchV2: () => flag("DEEP_RESEARCH_V2", true),

  /**
   * Phase J — performance journal. ON by default; read-only and descriptive.
   *
   * OFF stops building the journal and stops feeding personal notes into the
   * lessons block. It never gated a recommendation, so there is nothing else to
   * withdraw.
   */
  performanceJournalV1: () => flag("PERFORMANCE_JOURNAL_V1", true),

  /**
   * Re-evaluation triggers (constitution §6). ON by default.
   *
   * OFF stops the tracker RAISING new decision cycles. It never let the tracker
   * decide anything, so off simply means a plan is not revisited until the
   * operator or deep research asks.
   */
  reevaluationTriggersV1: () => flag("REEVALUATION_TRIGGERS_V1", true),
};

/** Snapshot of every feature flag's current runtime value (for /api/debug/features). */
export function featureFlagSnapshot(): Record<string, boolean> {
  return {
    candleWarehouse: FEATURES.candleWarehouse(),
    agentSkillsV1: FEATURES.agentSkillsV1(),
    agentContextV2: FEATURES.agentContextV2(),
    agentMemoryWriteV1: FEATURES.agentMemoryWriteV1(),
    agentRunTraceV1: FEATURES.agentRunTraceV1(),
    visionDecisionV1: FEATURES.visionDecisionV1(),
    caseMemoryV1: FEATURES.caseMemoryV1(),
    agentDoctrineV3: FEATURES.agentDoctrineV3(),
    tradabilityGateV1: FEATURES.tradabilityGateV1(),
    recRevisionsV1: FEATURES.recRevisionsV1(),
    recLifecycleAlertsV1: FEATURES.recLifecycleAlertsV1(),
    agentTradeModeV1: FEATURES.agentTradeModeV1(),
    patternAtlasV1: FEATURES.patternAtlasV1(),
    evidencePipelineV2: FEATURES.evidencePipelineV2(),
    deepResearchV2: FEATURES.deepResearchV2(),
    performanceJournalV1: FEATURES.performanceJournalV1(),
    reevaluationTriggersV1: FEATURES.reevaluationTriggersV1(),
  };
}

/**
 * Every unified-agent phase flag, with the phase it rolls back.
 *
 * Exported so a guard test can assert that each phase named in the plan actually
 * HAS a flag — a phase without one cannot be rolled back, and the plan's only
 * rollback mechanism is turning the flag off.
 */
export const PHASE_FLAGS: Record<string, { env: string; read: () => boolean; defaultOn: boolean }> = {
  A: { env: "AGENT_DOCTRINE_V3", read: FEATURES.agentDoctrineV3, defaultOn: true },
  B: { env: "REC_REVISIONS_V1", read: FEATURES.recRevisionsV1, defaultOn: true },
  C: { env: "REC_LIFECYCLE_ALERTS_V1", read: FEATURES.recLifecycleAlertsV1, defaultOn: true },
  D: { env: "AGENT_TRADE_MODE_V1", read: FEATURES.agentTradeModeV1, defaultOn: true },
  E: { env: "VISION_DECISION_V1", read: FEATURES.visionDecisionV1, defaultOn: true },
  F: { env: "PATTERN_ATLAS_V1", read: FEATURES.patternAtlasV1, defaultOn: true },
  G: { env: "CASE_MEMORY_V1", read: FEATURES.caseMemoryV1, defaultOn: true },
  H: { env: "EVIDENCE_PIPELINE_V2", read: FEATURES.evidencePipelineV2, defaultOn: true },
  I: { env: "DEEP_RESEARCH_V2", read: FEATURES.deepResearchV2, defaultOn: true },
  J: { env: "PERFORMANCE_JOURNAL_V1", read: FEATURES.performanceJournalV1, defaultOn: true },
};
