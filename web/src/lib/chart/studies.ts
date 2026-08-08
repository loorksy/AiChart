/**
 * Chart studies (indicators) the agent can turn on for the visible TradingView
 * chart. Shared by the layout channel (server route → hydrate hook), the chat
 * agent result (AgentFinalResult.studies) and the TV study adapter — a single
 * canonical vocabulary so every surface speaks the same 8 names.
 */

export const CHART_STUDY_NAMES = [
  "RSI",
  "EMA",
  "SMA",
  "MACD",
  "BB",
  "ATR",
  "Stochastic",
  "VWAP",
] as const;

export type ChartStudyName = (typeof CHART_STUDY_NAMES)[number];

export function isChartStudyName(v: unknown): v is ChartStudyName {
  return (
    typeof v === "string" && (CHART_STUDY_NAMES as readonly string[]).includes(v)
  );
}

/** One study to render on the chart. `id` keys idempotent re-application. */
export interface ChartStudy {
  /** Stable id (agent-chosen) so repeats replace instead of stacking. */
  id: string;
  name: ChartStudyName;
  /** Named study inputs (e.g. { length: 14 }); omitted → TradingView defaults. */
  inputs?: Record<string, number | string | boolean>;
  /** Where to render; omitted → the study's natural pane (see DEFAULT_OVERLAY). */
  pane?: "overlay" | "separate";
}

/** Studies that live on the price pane by default. */
export const DEFAULT_OVERLAY: Record<ChartStudyName, boolean> = {
  RSI: false,
  EMA: true,
  SMA: true,
  MACD: false,
  BB: true,
  ATR: false,
  Stochastic: false,
  VWAP: true,
};
