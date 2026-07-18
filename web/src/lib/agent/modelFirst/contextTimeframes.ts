/**
 * Canonical primary vs context timeframe mapping for scalping analysis.
 */
export type ContextTimeframeMap = {
  primary: string;
  context: string[];
};

const CANONICAL: Record<string, string[]> = {
  "1m": ["5m", "15m", "1h"],
  "3m": ["5m", "15m", "1h"],
  "5m": ["15m", "1h", "4h"],
  "15m": ["1h", "4h", "1d"],
  "30m": ["1h", "4h", "1d"],
  "1h": ["4h", "1d"],
  "4h": ["1d"],
  "1d": [],
};

export function resolveContextTimeframes(primary: string): ContextTimeframeMap {
  const key = primary.trim().toLowerCase();
  const context = CANONICAL[key] ?? ["15m", "1h"];
  return { primary: key, context: context.filter((tf) => tf !== key) };
}

export type AnalysisScopeMode =
  | "chart_bound"
  | "symbol_scan"
  | "timeframe_scan"
  | "market_scan";

export interface AnalysisScope {
  mode: AnalysisScopeMode;
  symbolConstraint: string | null;
  timeframeConstraint: string | null;
  selectionSource: "user_selected_chart" | "user_explicit" | "model_market_scan";
  contextTimeframes: string[];
}

/** Platform agent: always chart-bound to the operator's selected chart. */
export function platformChartBoundScope(input: {
  symbol: string;
  timeframe: string;
}): AnalysisScope {
  const { primary, context } = resolveContextTimeframes(input.timeframe);
  return {
    mode: "chart_bound",
    symbolConstraint: input.symbol.toUpperCase(),
    timeframeConstraint: primary,
    selectionSource: "user_selected_chart",
    contextTimeframes: context,
  };
}
