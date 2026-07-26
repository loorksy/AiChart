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
  };
}
