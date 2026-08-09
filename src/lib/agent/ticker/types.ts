/**
 * Live thinking-ticker types. The ticker is a single changing line shown while
 * the agent runs. Its text is generated dynamically per run by the model —
 * NEVER from a static array — and is hidden entirely if generation fails.
 * It is UI-only: not activity history, not stored in chat messages.
 */

export type AgentTickerStage =
  | "thinking"
  | "understanding"
  | "market_context"
  | "candles"
  | "structure"
  | "liquidity"
  | "entries"
  | "news"
  | "risk"
  | "drawing"
  | "synthesizing"
  | "finalizing";

export type AgentTickerItem = {
  id: string;
  stage: AgentTickerStage;
  text: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  requiresEvidence?: boolean;
};
