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
  smartChartAgent: () => flag("FEATURE_SMART_CHART_AGENT", true),
  /** Warehouse-first /api/market/klines reads. ON by default. */
  candleWarehouse: () => flag("FEATURE_CANDLE_WAREHOUSE", true),
  /** Multi-agent orchestration (vs. legacy single-pass analyze). ON by default. */
  multiAgentAnalysis: () => flag("FEATURE_MULTI_AGENT_ANALYSIS", true),
  /** News & Macro Risk agent participation. */
  newsMacroAgent: () => flag("FEATURE_NEWS_MACRO_AGENT", true),
  /** Execution Guard — ON by default; only an explicit "false" disables it. */
  executionGuard: () => flag("FEATURE_AGENT_EXECUTION_GUARD", true),
  /** Route MCP run_market_analysis through the unified engine. ON by default. */
  mcpUnifiedEngine: () => flag("FEATURE_MCP_UNIFIED_ENGINE", true),
};

/** Snapshot of every feature flag's current runtime value (for /api/debug/features). */
export function featureFlagSnapshot(): Record<string, boolean> {
  return {
    smartChartAgent: FEATURES.smartChartAgent(),
    candleWarehouse: FEATURES.candleWarehouse(),
    multiAgentAnalysis: FEATURES.multiAgentAnalysis(),
    newsMacroAgent: FEATURES.newsMacroAgent(),
    mcpUnifiedEngine: FEATURES.mcpUnifiedEngine(),
    executionGuard: FEATURES.executionGuard(),
  };
}
