/**
 * Shared types for the Smart Chart Agent — the single visible chart-connected
 * agent. Internally the orchestrator coordinates specialist agents, but the
 * user sees one activity stream and one final result.
 */
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartStudy } from "@/lib/chart/studies";
import type { ActivationRule } from "@/lib/recommendations/activationRule";
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";

export type AgentIntent =
  | "new_trade_analysis"
  | "chart_analysis"
  | "draw_on_chart"
  | "draw_active_recommendation"
  | "explain_chart_drawings"
  | "discuss_user_drawing"
  | "modify_user_drawing"
  | "move_user_drawing"
  | "delete_user_drawing"
  | "analyze_with_user_drawings"
  | "clarify_drawing_reference"
  | "draw_trendline"
  | "draw_support_resistance"
  | "draw_poi_zones"
  | "enable_indicators"
  | "clear_agent_drawings"
  | "explain_active_recommendation"
  | "track_active_recommendation"
  | "cancel_active_recommendation"
  | "modify_active_recommendation"
  | "market_news"
  | "account_status"
  | "trade_execution"
  | "trade_management"
  | "general_question"
  | "platform_help"
  | "mixed_request";

export type AgentDecision =
  | "buy"
  | "sell"
  | "wait"
  | "informational"
  | "action_required";

export type AgentActivityType =
  | "data"
  | "tool"
  | "analysis"
  | "news"
  | "risk"
  | "drawing"
  | "execution"
  | "final";

export type AgentActivityStatus = "started" | "completed" | "warning" | "failed";

/** A public, user-safe description of what the agent is doing right now.
 *  NEVER carries raw chain-of-thought — only sanitized activity messages.
 *  `visible: false` marks an internal/debug event the UI must not render. */
export interface AgentActivityEvent {
  id: string;
  type: AgentActivityType;
  message: string;
  timestamp: number;
  status: AgentActivityStatus;
  visible?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentChartContext {
  symbol?: string;
  interval?: string;
  layoutId?: string;
  visibleRange?: { from: number; to: number };
  latestCandle?: {
    /** Symbol the chart's latest candle belongs to — used to reject symbol drift. */
    symbol?: string;
    /** Interval the chart's latest candle belongs to — used to reject TF drift. */
    interval?: string;
    time: number;
    open?: number;
    high?: number;
    low?: number;
    close: number;
    volume?: number;
  };
  /** Drawings currently known to AiChart for this layout. */
  drawings?: ChartDrawing[];
  /** Safe, serialized user-created drawings read from the chart (owner=user). */
  userDrawings?: SerializedChartDrawing[];
  /** The user's currently-selected drawing id (highest-priority "this" hint). */
  selectedDrawingId?: string;
  /** Recommendation currently rendered/restored on the chart, if any. */
  recommendation?: AgentRecommendation;
  /** The user's own linked MetaTrader account — the only market-data pipe. */
  dataSource?: "metaapi";
}

/** Short-term, per-session preferences the agent honors within a chart session. */
export interface AgentSessionMemory {
  sessionId: string;
  preferences: {
    allowExecution?: boolean;
    preferMinimalDrawings?: boolean;
    educationalOnly?: boolean;
  };
  lastSymbol?: string;
  lastInterval?: string;
  lastAnalysisId?: string;
  updatedAt: number;
}

export interface AgentRunContext {
  requestId: string;
  userId?: number;
  sessionId?: string;
  /** Emit a public activity event. The orchestrator sanitizes + timestamps. */
  emitActivity: (event: Omit<AgentActivityEvent, "id" | "timestamp">) => void;
  /** Optional internal/debug signal — NEVER shown to the user. Used for
   *  observability (e.g. intent classification) without leaking to the UI. */
  emitDebug?: (event: { type: string; [key: string]: unknown }) => void;
  /** Emit a run-stage lifecycle event (stage name + status + duration only —
   *  never evidence or reasoning). Optional: callers without a live client
   *  simply do not provide it. */
  emitStage?: (event: {
    stage: string;
    status: "running" | "done" | "failed" | "resumed";
    durationMs?: number;
  }) => void;
  /** Live cumulative SANITIZED answer text for the pending bubble (general
   *  answers only — replace semantics). The final result stays authoritative. */
  emitAnswerText?: (fullText: string) => void;
  /** Cooperative cancellation from the client (AbortController). */
  signal?: AbortSignal;
  /** Session preferences (educational-only, minimal drawings, no execution…). */
  session?: AgentSessionMemory;
}

/**
 * The model's reasoning, in a form the operator can read (never scratchpad).
 * Every recommendation carries one: a decision that cannot be explained from
 * its trace and its evidence is not a valid decision (architecture rule §0-ج).
 */
export interface DecisionTrace {
  hypotheses: Array<{
    scenario: string;
    supporting: string[];
    opposing: string[];
  }>;
  chosenBecause: string;
  planTypeBecause: string;
}

export interface AgentRecommendation {
  /** Layer 1 — the analytical view. Always a side on a successful analysis. */
  action: "buy" | "sell" | "wait";
  /** Layer 2 — how this plan is entered. */
  planType?: "immediate" | "anticipatory" | "conditional";
  /** Layer 3 — whether it can be acted on right now. */
  executionState?:
    | "valid_now"
    | "awaiting_activation"
    | "expired"
    | "invalidated"
    | "blocked";
  entry?: number;
  /** The area the plan is willing to enter from, not just the ideal price. */
  entryZone?: { low: number; high: number };
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  stop_loss?: number;
  take_profit?: number;
  targets?: number[];
  rr?: number;
  /** Net TP1 R after modelled spread/slippage. */
  netRr?: number;
  netRrTp2?: number;
  /** immediate | conditional — never machine codes in user copy. */
  activationClass?: "immediate" | "conditional";
  id?: string;
  status?: string;
  triggerCondition?: string;
  /** The machine-checkable form of `triggerCondition`; see activationRule.ts. */
  activationRule?: ActivationRule;
  invalidationLevel?: number;
  invalidationRule?: string;
  /** The runner-up scenario and what would switch the plan to it. */
  alternativeScenario?: string;
  /** How many candles of this timeframe the plan stays meaningful. */
  validityCandles?: number;
  /** Where the numbers came from — a validated candidate or evidence levels. */
  levelSource?: "candidate" | "evidence_levels";
  chartSnapshotHash?: string;
}

export interface AgentNewsRisk {
  level: "low" | "medium" | "high" | "unknown";
  reason: string;
}

/** A clickable follow-up option the assistant offered (also selectable by
 *  replying with its number, e.g. "1" / "١"). */
export interface AgentOption {
  id: string;
  label: string;
  prompt: string;
}

export interface AgentFinalResult {
  decision: AgentDecision;
  /**
   * The resolved execution-cost evidence for this analysis, in the serialized
   * wire shape (unit-named keys, explicit source and fallback). Deferred #16:
   * the MCP surface consumes this from the analyze response.
   */
  costEvidence?: Record<string, unknown>;
  /**
   * Three-state outcome contract (execution_validated / descriptive_only /
   * operational_blocker). Additive: legacy clients keep reading `decision`.
   * The orchestrator guarantees this is set on every returned result.
   */
  envelope?: import("./resultEnvelope").ResultEnvelope;
  /**
   * SERVER-ONLY machine cause for an operational blocker (provider message,
   * stage detail). Persisted into the audit row so a Request ID stays
   * diagnosable after logs rotate; stripped before the browser sees the result.
   */
  operatorFailureDetail?: string;
  /**
   * Evidence behind the answer (RELIABILITY_PLAN.md item 13): the matched
   * strategy, its historical trade count, walk-forward verdict and deployment
   * state. Present only when validated factory evidence was actually found —
   * it SHOWS the gates rather than replacing them, so a bare confidence number
   * is never the whole story the operator sees.
   */
  evidenceCard?: import("./evidenceCard").EvidenceCard;
  /**
   * Why this decision, in the operator's terms: the scenarios weighed, what
   * supported and opposed each, why this one won, and why this plan type.
   *
   * Not optional decoration. A decision that cannot be explained from its own
   * trace is not one the operator can act on or the learning loop can use, so
   * the decision contract requires it and it is carried all the way out.
   */
  decisionTrace?: DecisionTrace;
  /**
   * The evidence card, dimension by dimension, with `unavailable` as a real
   * grade. One blended percentage hides exactly what matters — a plan can rest
   * on strong structure with no statistical history behind it.
   */
  evidenceDimensions?: import("./evidenceDimensions").EvidenceDimension[];
  /**
   * Immutable snapshot of the complete evidence input consumed by the unified
   * decision engine. Re-evaluations and revisions persist this exact object.
   */
  evidenceSnapshot?: Record<string, unknown>;
  confidence: number;
  /** Distinct confidence fields — UI must use displayKind/displayValue. */
  confidenceSemantics?: import("./confidenceSemantics").ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  activityEvents: AgentActivityEvent[];
  /** Run-stage lifecycle events (stage names + durations only) — the persisted
   *  "how this answer was produced" checklist. Attached by the stream route. */
  stages?: import("./stageEvents").AgentStageEvent[];
  recommendation?: AgentRecommendation;
  drawings?: ChartDrawing[];
  /**
   * Explicit request to remove agent-owned drawings. Distinct from
   * `drawings: []`, which many paths use to mean "no new drawings this turn".
   */
  clearAgentDrawings?: boolean;
  /** Indicators (studies) to enable on the visible chart (idempotent by id). */
  studies?: ChartStudy[];
  /** User-drawing mutations to apply AFTER the final SSE (idempotent by id). */
  drawingMutations?: UserDrawingMutationCommand[];
  newsRisk?: AgentNewsRisk;
  /** analysisId stamps every drawing this run produced (versioning + undo). */
  analysisId?: string;
  recommendationId?: string;
  activeRecommendation?: {
    id: string;
    status: string;
    direction: "buy" | "sell";
    symbol: string;
    interval: string;
  };
  requiresConfirmation?: boolean;
  confirmationPayload?: AgentConfirmationPayload;
  /** Follow-up options for this reply (clickable + number-selectable). */
  options?: AgentOption[];
  /** Concise public reasons behind the decision — never chain-of-thought. */
  publicReasoningSummary?: string[];
  /** Skills whose content was actually loaded into this run's prompts. */
  selectedSkills?: Array<{ name: string; version: string }>;
  /** Skills selected for this run whose load failed (reported honestly). */
  skillLoadFailures?: Array<{ name: string; version: string; error: string }>;
  /**
   * Research systems that actually contributed (or were explicitly skipped).
   * Never claim Backtest/DNA/Shadow/Swarm influence unless status === "used".
   */
  researchEvidence?: import("./researchEvidence").ResearchEvidenceBundle;
  /** Truthful runtime evidence timeline for this run. */
  evidenceTimeline?: import("./researchEvidence").EvidenceTimelineStep[];
  /** Candle coverage report for this run (available/required/refill). */
  candleCoverage?: import("./dataQualityPolicy").CandleCoverageReport;
  /** Dev-only diagnostics: whether the run used the synthesizer/LLM,
   *  ticker state, candle counts, and the drawing-plan
   *  decision. Never carries secrets or raw reasoning. */
  debugDecisionFlow?: AgentDebugDecisionFlow;
}

export interface AgentDebugDecisionFlow {
  usedLLM: boolean;
  tickerGenerated: boolean;
  tickerHiddenReason?: string;
  candleCount: number;
  htfCandleCount: number;
  dailyCandleCount: number;
  selectedLevelsCount: number;
  rejectedLevelsCount: number;
  drawingPlanReason: string;
  dataSource: string;
  warehouseSource?: string;
  chartSnapshotHash?: string;
  marketSync?: {
    ok: boolean;
    reason: string;
    warehouseLastTime?: number | null;
    liveLastTime?: number | null;
    chartLastTime?: number | null;
    warehouseClose?: number | null;
    liveClose?: number | null;
    chartClose?: number | null;
  };
}

/** What the user must explicitly confirm before any MT5 execution. */
export interface AgentConfirmationPayload {
  symbol: string;
  direction: "buy" | "sell";
  entry?: number;
  stop_loss?: number;
  targets?: number[];
  estimatedRR?: number;
  newsWarning?: string;
  spreadWarning?: string;
}
