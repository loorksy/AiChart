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
import { computeRecommendationExpiry } from "@/lib/agent/recommendationExpiry";
import { resolveValidity } from "@/lib/agent/trading/tradePlan";
import { spanStyleForInterval } from "@/lib/agent/trading/scalpGeometry";
import type { TrackedEntryType, TrackedRecommendation } from "./types";

function mapEntryType(entryType?: string): TrackedEntryType {
  if (!entryType || entryType === "market") return "market";
  if (entryType.includes("limit")) return "limit";
  return "pending";
}

/**
 * Best-effort market context out of the result's frozen evidence snapshot —
 * the same object the decision engine reasoned over, which carries the symbol,
 * interval and current price even when the narrow `activeRecommendation` wire
 * shape does not.
 */
function snapshotContext(result: AgentFinalResult): {
  currentPrice?: number;
  symbol?: string;
  interval?: string;
} {
  const modelContext = (
    result.evidenceSnapshot as { modelContext?: unknown } | undefined
  )?.modelContext;
  if (!modelContext || typeof modelContext !== "object") return {};
  const ctx = modelContext as Record<string, unknown>;
  return {
    currentPrice:
      typeof ctx.currentPrice === "number" && Number.isFinite(ctx.currentPrice)
        ? ctx.currentPrice
        : undefined,
    symbol: typeof ctx.symbol === "string" && ctx.symbol ? ctx.symbol : undefined,
    interval:
      typeof ctx.interval === "string" && ctx.interval ? ctx.interval : undefined,
  };
}

function firstFinite(
  ...values: Array<number | null | undefined>
): number | undefined {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return undefined;
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
  // Status follows the execution state when the result states one (mirrors the
  // server: only a plan executable RIGHT NOW starts triggered); legacy results
  // without one keep the activation-class/entry-type derivation.
  const triggered = rec.executionState
    ? rec.executionState === "valid_now"
    : activationClass === "immediate" || entryType === "market";

  const snapshot = snapshotContext(result);
  const marketSync = result.debugDecisionFlow?.marketSync;
  const createdAt = Date.now();
  const interval = active?.interval || snapshot.interval || "";
  // Same ceiling as storeFinalRecommendation: candle validity capped by
  // timeframe/style expiry — never a raw candles×interval that outlives the
  // server plan (or a silent 30m scalp ceiling for every frame).
  const expiresAt = resolveValidity({
    validityCandles: rec.validityCandles ?? 6,
    interval,
    maxExpiresAt: computeRecommendationExpiry({
      interval,
      scalp: spanStyleForInterval(interval) === "scalp",
      from: createdAt,
    }),
    now: createdAt,
  }).expiresAt;

  return {
    id,
    userId: 0,
    symbol: active?.symbol || snapshot.symbol || "",
    interval,
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
    planType:
      rec.planType ??
      (activationClass === "immediate" ? "immediate" : "conditional"),
    executionState: rec.executionState,
    entryLow: rec.entryZone?.low,
    entryHigh: rec.entryZone?.high,
    validityCandles: rec.validityCandles,
    triggerCondition: rec.triggerCondition,
    invalidationLevel: rec.invalidationLevel ?? rec.stop_loss,
    createdAt,
    createdCandleTime: createdAt,
    expiresAt,
    triggeredAt: triggered ? createdAt : undefined,
    priceAtCreation:
      snapshot.currentPrice ??
      firstFinite(
        marketSync?.liveClose,
        marketSync?.chartClose,
        marketSync?.warehouseClose,
      ),
  };
}

/** True when the AI has a side opinion but no executable levels. */
export function isDirectionalOpinionOnly(result: AgentFinalResult): boolean {
  const rec = result.recommendation;
  if (!rec) return false;
  if (rec.action !== "buy" && rec.action !== "sell") return false;
  return rec.entry == null || rec.stop_loss == null || !rec.targets?.length;
}
