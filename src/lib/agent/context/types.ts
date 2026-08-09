import type { AgentChartContext } from "../types";

export type ContextLocale = "ar" | "en";
export type ContextRole = "user" | "assistant" | "tool";
export type ContextMessageKind =
  | "conversation"
  | "tool_call"
  | "tool_result"
  | "summary"
  | "memory"
  | "trade_lesson"
  | "recommendation";

export type ContextSafetyClassification =
  | "safe"
  | "untrusted_content"
  | "secret_detected"
  | "instruction_like"
  | "oversized"
  | "expired";

export interface ContextToolCall {
  id: string;
  name: string;
  arguments?: string;
}

export interface NormalizedContextMessage {
  id: string;
  role: ContextRole;
  kind: ContextMessageKind;
  content: string;
  /** Stable input order. It is the final tie-breaker for missing/duplicate timestamps. */
  sequence: number;
  createdAt?: number;
  toolCall?: ContextToolCall;
  toolCallId?: string;
  symbol?: string;
  timeframe?: string;
  recommendationId?: string;
  analysisId?: string;
  important?: boolean;
  current?: boolean;
  historicalMarketData?: boolean;
  safety: ContextSafetyClassification[];
  source: "history" | "current_user" | "memory" | "trade_lesson" | "recommendation" | "summary";
}

export interface RawContextMessage {
  id?: string;
  role: ContextRole;
  kind?: ContextMessageKind;
  content?: string;
  createdAt?: number | null;
  toolCall?: ContextToolCall;
  toolCallId?: string;
  symbol?: string;
  timeframe?: string;
  recommendationId?: string;
  analysisId?: string;
  important?: boolean;
  historicalMarketData?: boolean;
  source?: NormalizedContextMessage["source"];
}

export interface SafeRecommendationContext {
  id: string;
  source: "canonical" | "session" | "chart" | "history";
  symbol: string;
  timeframe: string;
  direction: "buy" | "sell";
  status: string;
  createdAt?: number;
  analysisId?: string;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  summary?: string;
}

export interface SafeMemoryContext {
  id: string;
  content: string;
  expiresAt?: number | null;
  confidence?: number;
  source?: string;
}

export interface SafeTradeLessonContext {
  id: string;
  content: string;
  symbol?: string;
  timeframe?: string;
  createdAt?: number;
}

export type ContextWarningCode =
  | "history_rejected"
  | "secret_redacted"
  | "unsafe_memory_excluded"
  | "expired_memory_excluded"
  | "message_truncated"
  | "orphan_tool_result_removed"
  | "tool_result_placeholder_added"
  | "budget_too_small"
  | "historical_market_data_omitted";

export interface ContextWarning {
  code: ContextWarningCode;
  messageId?: string;
}

export interface ContextDiagnostics {
  inputMessageCount: number;
  selectedHistoryCount: number;
  removedCount: number;
  compactedCount: number;
  placeholderToolResultCount: number;
}

export interface AgentConversationContext {
  messages: NormalizedContextMessage[];
  estimatedTokens: number;
  selectedMessageIds: string[];
  removedMessageIds: string[];
  compactedMessageIds: string[];
  recalledMemoryIds: string[];
  activeRecommendation?: SafeRecommendationContext;
  warnings: ContextWarning[];
  diagnostics?: ContextDiagnostics;
}

export interface BuildAgentConversationContextInput {
  userId: number;
  chatId?: string;
  sessionId: string;
  userMessage: string;
  locale: ContextLocale;
  chartContext?: AgentChartContext;
  activeRecommendation?: SafeRecommendationContext | null;
  persistedMessages?: RawContextMessage[];
  recalledMemories?: SafeMemoryContext[];
  tradeLessons?: SafeTradeLessonContext[];
  tokenBudget: number;
  now?: number;
  includeDiagnostics?: boolean;
}

export interface ContextSelectionOptions {
  maxTokens: number;
  recentTurnCount?: number;
  relevantTurnCount?: number;
  symbol?: string;
  timeframe?: string;
  recommendationId?: string;
  analysisId?: string;
}

export interface ContextSelectionResult {
  turns: NormalizedContextMessage[];
  estimatedTokens: number;
  omittedTurnCount: number;
}

/** Compatibility alias for the initial Phase 1 implementation. */
export type ContextTurn = NormalizedContextMessage;
