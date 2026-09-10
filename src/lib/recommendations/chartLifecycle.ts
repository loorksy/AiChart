/**
 * The slice of a tracked recommendation the live chart needs to move its P/L
 * box through pending → active → closed. Pure projection: no market data, no
 * grading — the tracker already decided; this only carries its verdict.
 */
import type { Recommendation } from "@/lib/types";
import type { TrackedRecommendation } from "./types";
import { isTerminalOutcome } from "./types";

export interface ChartLifecycle {
  tracked_id: string;
  chat_id: string | null;
  symbol: string;
  direction: "buy" | "sell";
  entry: number;
  stop_loss: number;
  targets: number[];
  status: TrackedRecommendation["status"];
  outcome: TrackedRecommendation["outcome"];
  created_at: number;
  expires_at: number;
  triggered_at: number | null;
  exit_at: number | null;
  terminal: boolean;
}

/** When the trade ended, from whichever terminal stamp the tracker wrote. */
export function trackedExitAt(rec: TrackedRecommendation): number | null {
  if (rec.exitAt != null && Number.isFinite(rec.exitAt)) return rec.exitAt;
  if (!isTerminalOutcome(rec.outcome)) return null;
  const candidates = [
    rec.slHitAt,
    rec.tp3HitAt,
    rec.tp2HitAt,
    rec.tp1HitAt,
    rec.expiredAt,
    rec.cancelledAt,
    rec.invalidatedAt,
  ].filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
  if (rec.outcome === "loss" && rec.slHitAt) return rec.slHitAt;
  if (rec.outcome === "win_tp3" && rec.tp3HitAt) return rec.tp3HitAt;
  if (rec.outcome === "win_tp2" && rec.tp2HitAt) return rec.tp2HitAt;
  if (rec.outcome === "win_tp1" && rec.tp1HitAt) return rec.tp1HitAt;
  return candidates.length ? Math.max(...candidates) : null;
}

export function chartLifecycleOf(rec: TrackedRecommendation): ChartLifecycle {
  return {
    tracked_id: rec.id,
    chat_id: rec.chatId ?? null,
    symbol: rec.symbol,
    direction: rec.direction,
    entry: rec.entry,
    stop_loss: rec.stopLoss,
    targets: rec.targets,
    status: rec.status,
    outcome: rec.outcome,
    created_at: rec.createdAt,
    expires_at: rec.expiresAt,
    triggered_at: rec.triggeredAt ?? null,
    exit_at: trackedExitAt(rec),
    terminal: isTerminalOutcome(rec.outcome),
  };
}

/**
 * Does this lifecycle describe the plan painted on the chart? Same side and
 * the same entry/stop (to the tick) — a status must never be stapled onto a
 * different trade's box.
 */
export function lifecycleMatchesChartRecommendation(
  life: ChartLifecycle,
  rec: Pick<Recommendation, "action" | "entry" | "stop_loss" | "tracked_id"> | null | undefined,
): boolean {
  if (!rec) return false;
  if (rec.tracked_id && rec.tracked_id === life.tracked_id) return true;
  if (rec.action !== life.direction) return false;
  if (rec.entry == null || rec.stop_loss == null) return false;
  const tol = Math.max(0.01, Math.abs(life.entry) * 0.0002);
  return (
    Math.abs(rec.entry - life.entry) <= tol && Math.abs(rec.stop_loss - life.stop_loss) <= tol
  );
}

/**
 * Merge the tracker's verdict into the chart payload. Returns the same object
 * when nothing changed so React state (and the adapter fingerprint) stay put.
 */
export function mergeLifecycleIntoRecommendation(
  rec: Recommendation,
  life: ChartLifecycle,
): Recommendation {
  const next: Recommendation = {
    ...rec,
    tracked_id: life.tracked_id,
    status: life.status as Recommendation["status"],
    outcome: life.outcome,
    triggered_at: life.triggered_at,
    exit_at: life.exit_at,
    expires_at: life.expires_at,
  };
  const same =
    rec.tracked_id === next.tracked_id &&
    rec.status === next.status &&
    rec.outcome === next.outcome &&
    (rec.triggered_at ?? null) === (next.triggered_at ?? null) &&
    (rec.exit_at ?? null) === (next.exit_at ?? null) &&
    (rec.expires_at ?? null) === (next.expires_at ?? null);
  return same ? rec : next;
}
