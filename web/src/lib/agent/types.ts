/**
 * Shared types for the Smart Chart Agent — the single visible chart-connected
 * agent. Internally the orchestrator coordinates specialist agents, but the
 * user sees one activity stream and one final result.
 */
import type { ChartDrawing } from "@/lib/chartDrawings";
import type {
  SerializedChartDrawing,
  UserDrawingMutationCommand,
} from "@/lib/chart/drawings/types";
import type { ReasoningEffort } from "./modelFirst/modelRegistry";

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
  | "action_required"
  | "data_unavailable"
  | "model_unavailable"
  | "model_timeout"
  | "invalid_model_output"
  | "analysis_failed"
  | "execution_unavailable"
  | "reanalysis_required";

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
  /** oanda (default) or the user's broker bridge. */
  dataSource?: "oanda" | "ea";
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
  /** Cooperative cancellation from the client (AbortController). */
  signal?: AbortSignal;
  /** Session preferences (educational-only, minimal drawings, no execution…). */
  session?: AgentSessionMemory;
}

export interface AgentRecommendation {
  action: "buy" | "sell" | "wait";
  entry?: number;
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
  /** Model-authored entry zone (candidate-free). */
  entryZone?: { low?: number | null; high?: number | null; preferred?: number | null };
  /** Distinct from analytical WAIT — readiness for broker execution. */
  executionReadiness?:
    | "ready_for_approval"
    | "waiting_for_confirmation"
    | "levels_require_refresh"
    | "technically_unavailable"
    | "none";
  id?: string;
  status?: string;
  triggerCondition?: string;
  invalidationLevel?: number;
  invalidationRule?: string;
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
  confidence: number;
  /** Distinct confidence fields — UI must use displayKind/displayValue. */
  confidenceSemantics?: import("./confidenceSemantics").ConfidenceSemantics;
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  activityEvents: AgentActivityEvent[];
  recommendation?: AgentRecommendation;
  drawings?: ChartDrawing[];
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
  /** Redacted model-first provenance for internal run traces only. */
  modelRun?: AgentModelRunMetadata;
  /** Dev-only diagnostics: whether the run used the synthesizer/LLM,
   *  ticker state, candle counts, and the drawing-plan
   *  decision. Never carries secrets or raw reasoning. */
  debugDecisionFlow?: AgentDebugDecisionFlow;
}

export interface AgentModelRunMetadata {
  provider: "openai";
  modelId: string;
  reasoningEffort: ReasoningEffort | null;
  responseIds: string[];
  tokenUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  snapshotId: string | null;
  snapshotFingerprint: string | null;
  imageTimeframes: string[];
  decision: "buy" | "sell" | "wait" | null;
  validatorErrors: string[];
  repaired: boolean;
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

/** What the user must explicitly confirm before any MT5/EA execution. */
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
