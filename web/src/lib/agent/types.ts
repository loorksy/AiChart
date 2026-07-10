/**
 * Shared types for the Smart Chart Agent — the single visible chart-connected
 * agent. Internally the orchestrator coordinates specialist agents, but the
 * user sees one activity stream and one final result.
 */
import type { ChartDrawing } from "@/lib/chartDrawings";

export type AgentIntent =
  | "new_trade_analysis"
  | "chart_analysis"
  | "draw_on_chart"
  | "explain_chart_drawings"
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
    time: number;
    open?: number;
    high?: number;
    low?: number;
    close: number;
    volume?: number;
  };
  /** Drawings currently known to AiChart for this layout. */
  drawings?: ChartDrawing[];
  /** Recommendation currently rendered/restored on the chart, if any. */
  recommendation?: AgentRecommendation;
  /** oanda (default) or the user's broker bridge. */
  dataSource?: "oanda" | "ea";
}

/** Short-term, per-session preferences the agent honors within a chart session. */
export interface AgentSessionMemory {
  sessionId: string;
  preferences: {
    tradingStyle?: "scalping" | "intraday" | "swing";
    riskMode?: "low" | "medium" | "high";
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
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  activityEvents: AgentActivityEvent[];
  recommendation?: AgentRecommendation;
  drawings?: ChartDrawing[];
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
  /** Dev-only diagnostics: whether the run used the synthesizer/LLM or a
   *  deterministic fallback, ticker state, candle counts, and the drawing-plan
   *  decision. Never carries secrets or raw reasoning. */
  debugDecisionFlow?: AgentDebugDecisionFlow;
}

export interface AgentDebugDecisionFlow {
  usedLLM: boolean;
  usedDeterministicFallback: boolean;
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
  volume?: number;
  entry?: number;
  stop_loss?: number;
  targets?: number[];
  estimatedRR?: number;
  executionMode?: "demo" | "live" | "simulation";
  newsWarning?: string;
  spreadWarning?: string;
}
