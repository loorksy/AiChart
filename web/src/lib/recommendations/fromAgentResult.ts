/**
 * Build a display-only TrackedRecommendation from an agent chat result so the
 * chat can render the tracker card immediately (live updates come from the
 * server tracker / recommendations page). Returns null when the result has no
 * buy/sell recommendation with executable levels to track.
 *
 * Directional opinions without entry/stop/targets must NOT produce a full
 * recommendation card — callers should render a lighter market-view instead.
 */
import type { AgentFinalResult } from "@/lib/agent/types";
import type { TrackedEntryType, TrackedRecommendation } from "./types";

function mapEntryType(entryType?: string): TrackedEntryType {
  if (!entryType || entryType === "market") return "market";
  if (entryType.includes("limit")) return "limit";
  return "pending";
}

export function trackedRecommendationFromResult(
  result: AgentFinalResult,
): TrackedRecommendation | null {
  const rec = result.recommendation;
  const active = result.activeRecommendation;
  if (!rec || (rec.action !== "buy" && rec.action !== "sell")) return null;
  if (rec.entry == null || rec.stop_loss == null) return null;
  if (!rec.targets?.length && rec.take_profit == null) return null;
  const id = result.recommendationId ?? active?.id;
  if (!id) return null;

  const targets = rec.targets?.length
    ? rec.targets
    : rec.take_profit != null
      ? [rec.take_profit]
      : [];
  const entryType = mapEntryType(rec.entryType);
  const activationClass =
    rec.activationClass ??
    (entryType === "market" ? "immediate" : "conditional");
  const triggered = activationClass === "immediate" || entryType === "market";

  return {
    id,
    userId: 0,
    symbol: active?.symbol ?? "",
    interval: active?.interval ?? "",
    direction: rec.action,
    entryType,
    entry: rec.entry,
    stopLoss: rec.stop_loss,
    targets,
    status: triggered ? "triggered" : "pending_entry",
    outcome: "pending",
    rr: rec.rr,
    netRr: rec.netRr,
    netRrTp2: rec.netRrTp2,
    activationClass,
    triggerCondition: rec.triggerCondition,
    invalidationLevel: rec.invalidationLevel ?? rec.stop_loss,
    createdAt: Date.now(),
    createdCandleTime: Date.now(),
    expiresAt: Date.now(),
    triggeredAt: triggered ? Date.now() : undefined,
    priceAtCreation: undefined,
  };
}

/** True when the AI has a side opinion but no executable levels. */
export function isDirectionalOpinionOnly(result: AgentFinalResult): boolean {
  const rec = result.recommendation;
  if (!rec) return false;
  if (rec.action !== "buy" && rec.action !== "sell") return false;
  return rec.entry == null || rec.stop_loss == null || !rec.targets?.length;
}
