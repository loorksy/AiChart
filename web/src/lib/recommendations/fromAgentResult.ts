/**
 * Build a display-only TrackedRecommendation from an agent chat result so the
 * chat can render the tracker card immediately (live updates come from the
 * server tracker / recommendations page). Returns null when the result has no
 * buy/sell recommendation to track.
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
  const id = result.recommendationId ?? active?.id;
  if (!id) return null;

  const targets = rec.targets?.length
    ? rec.targets
    : rec.take_profit != null
      ? [rec.take_profit]
      : [];
  const entryType = mapEntryType(rec.entryType);
  const triggered = entryType === "market";

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
    createdAt: Date.now(),
    createdCandleTime: Date.now(),
    expiresAt: Date.now(),
    triggeredAt: triggered ? Date.now() : undefined,
  };
}
