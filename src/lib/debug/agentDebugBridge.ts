/**
 * Development/test-only debug bridge. Exposes a READ-ONLY snapshot of UI/agent
 * synchronization state on `window.__LONORA_AGENT_DEBUG__` so Playwright can
 * assert chart/chat/voice state without scraping the DOM or touching trading
 * logic. NEVER exposes secrets, tokens, raw audio, or provider payloads — only
 * plain, already-public UI values.
 *
 * Disabled in production builds.
 */
import type { AgentFinalResult } from "@/lib/agent/types";

export interface AgentDebugSnapshot {
  symbol: string;
  interval: string;
  latestChartCandleTime: number | null;
  latestChartClose: number | null;
  visibleRange: { from: number; to: number } | null;
  drawingCount: number;
  userDrawingCount: number;
  agentDrawingCount: number;
  activeRecommendation: {
    action: string;
    entry: number | null;
    stop_loss: number | null;
    take_profit: number | null;
  } | null;
  activeChatId: string | null;
  locale: string;
  /** Chart sheet state below `xl`, and the pane layout from `xl` up. */
  chartSheetOpen: boolean;
  desktopLayout: string;
  lastFinalResult: {
    decision: string;
    summary: string;
    hasDrawingMutations: boolean;
    requiresConfirmation: boolean;
  } | null;
}

const KEY = "__LONORA_AGENT_DEBUG__";

export function debugBridgeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

/** Redact a final result to public, non-sensitive fields only. */
export function publicFinalResult(
  r: AgentFinalResult | null,
): AgentDebugSnapshot["lastFinalResult"] {
  if (!r) return null;
  return {
    decision: r.decision,
    summary: r.summary,
    hasDrawingMutations: Boolean(r.drawingMutations?.length),
    requiresConfirmation: Boolean(r.requiresConfirmation),
  };
}

/** Install (or refresh) the read-only snapshot getter on window. */
export function installAgentDebugBridge(getSnapshot: () => AgentDebugSnapshot): void {
  if (!debugBridgeEnabled()) return;
  (window as unknown as Record<string, unknown>)[KEY] = {
    get snapshot() {
      return getSnapshot();
    },
  };
}

export function removeAgentDebugBridge(): void {
  if (typeof window === "undefined") return;
  delete (window as unknown as Record<string, unknown>)[KEY];
}
