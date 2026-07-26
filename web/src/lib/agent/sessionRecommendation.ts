import type { ChartDrawing } from "@/lib/chartDrawings";
import {
  cancelTrackedRecommendation,
  listActiveTrackedRecommendations,
  updateTrackedRecommendation,
} from "@/lib/recommendations/recommendationStore";

export type RecommendationStatus =
  | "pending_entry"
  | "triggered"
  | "tp1_hit"
  | "tp2_hit"
  | "sl_hit"
  | "invalidated"
  | "expired"
  | "cancelled";

export type ActiveRecommendation = {
  id: string;
  /** Tenant owner. The in-memory object is a cache; canonical persistence is authoritative. */
  userId?: number;
  analysisId: string;
  sessionId: string;
  layoutId?: string;
  symbol: string;
  interval: string;
  createdAt: number;
  /** Time of the candle that was forming when the recommendation was created.
   *  Lifecycle evaluation must start STRICTLY after this candle so the creation
   *  candle can never instantly trigger/SL the recommendation. */
  createdCandleTime?: number;
  expiresAt?: number;
  direction: "buy" | "sell";
  /** How this plan is entered (result contract layer 2). */
  planType?: "immediate" | "anticipatory" | "conditional";
  /** Whether it can be entered right now (result contract layer 3). */
  executionState?: "valid_now" | "awaiting_activation" | "expired" | "invalidated" | "blocked";
  /** Verified statistical backing behind the plan, or its absence stated. */
  statisticalSupport?: "strong" | "moderate" | "weak" | "unavailable";
  entry: number;
  /** The area the plan accepts, not only the ideal price. */
  entryZone?: { low: number; high: number };
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  stopLoss: number;
  targets: number[];
  takeProfit?: number;
  rr?: number;
  status: RecommendationStatus;
  triggerCondition: string;
  invalidationLevel: number;
  invalidationRule: string;
  /** The runner-up scenario and what would switch the plan to it. */
  alternativeScenario?: string;
  /** Validity in candles of this timeframe, as decided by the agent. */
  validityCandles?: number;
  setupType?: string;
  poi?: {
    type: "demand" | "supply" | "retest";
    low: number;
    high: number;
    score?: number;
    grade?: string;
  };
  summary: string;
  keyReasons: string[];
  riskWarnings: string[];
  publicReasoningSummary: string[];
  drawings?: ChartDrawing[];
  chartSnapshotHash?: string;
  priceAtCreation?: number;
};

const store = new Map<string, ActiveRecommendation>();

function normalizeSymbol(symbol?: string | null): string {
  return (symbol ?? "").toUpperCase().trim();
}

function key(sessionId: string, symbol?: string | null): string {
  return `${sessionId}:${normalizeSymbol(symbol) || "*"}`;
}

export function isTerminalRecommendationStatus(
  status: RecommendationStatus,
): boolean {
  return ["sl_hit", "tp1_hit", "tp2_hit", "invalidated", "expired", "cancelled"].includes(status);
}

function isTerminal(status: RecommendationStatus): boolean {
  return isTerminalRecommendationStatus(status);
}

/**
 * Recommendation lifetime by timeframe/style. Scalps expire fast; higher
 * timeframes get days. Returns an absolute epoch-ms deadline from `from`.
 */
export function computeRecommendationExpiry(input: {
  interval: string;
  scalp?: boolean;
  from?: number;
}): number {
  const from = input.from ?? Date.now();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const iv = (input.interval ?? "").toLowerCase().trim();
  if (input.scalp) return from + 30 * MIN;
  if (iv === "1m" || iv === "5m") return from + 45 * MIN;
  if (iv === "15m" || iv === "30m") return from + 3 * HOUR;
  if (iv === "1h" || iv === "4h") return from + 36 * HOUR;
  if (iv === "1d" || iv === "1w") return from + 7 * 24 * HOUR;
  // Unknown timeframe → a conservative intraday default.
  return from + 4 * HOUR;
}

export async function rememberActiveRecommendation(
  input: ActiveRecommendation,
): Promise<void> {
  store.set(input.id, input);
  store.set(key(input.sessionId, input.symbol), input);
  store.set(key(input.sessionId), input);
}

export async function getActiveRecommendation(
  sessionId: string,
  symbol?: string,
  userId?: number,
): Promise<ActiveRecommendation | null> {
  let rec =
    store.get(key(sessionId, symbol)) ??
    store.get(key(sessionId)) ??
    null;
  if (!rec && userId != null) {
    const tracked = await listActiveTrackedRecommendations({ userId, limit: 100 });
    const match = tracked.find(
      (item) =>
        item.chatId === sessionId &&
        (!symbol || normalizeSymbol(item.symbol) === normalizeSymbol(symbol)),
    );
    if (match) {
      rec = {
        id: match.id,
        userId,
        analysisId: match.analysisId ?? "canonical-replay",
        sessionId,
        symbol: match.symbol,
        interval: match.interval,
        createdAt: match.createdAt,
        createdCandleTime: match.createdCandleTime,
        expiresAt: match.expiresAt,
        direction: match.direction,
        entry: match.entry,
        entryType:
          match.entryType === "market"
            ? "market"
            : match.direction === "buy"
              ? "buy_limit"
              : "sell_limit",
        stopLoss: match.stopLoss,
        targets: match.targets,
        takeProfit: match.targets[0],
        rr: match.rr,
        status: match.status as RecommendationStatus,
        triggerCondition: "canonical recommendation entry condition",
        invalidationLevel: match.invalidationLevel ?? match.stopLoss,
        invalidationRule: "canonical recommendation invalidation rule",
        setupType: match.setupType,
        summary: "Canonical recommendation",
        keyReasons: [],
        riskWarnings: [],
        publicReasoningSummary: [],
        priceAtCreation: match.priceAtCreation,
      };
      await rememberActiveRecommendation(rec);
    }
  }
  if (!rec) return null;
  if (rec.expiresAt && Date.now() > rec.expiresAt && !isTerminal(rec.status)) {
    const expired = { ...rec, status: "expired" as const };
    await rememberActiveRecommendation(expired);
    return expired;
  }
  return rec;
}

export async function updateActiveRecommendationStatus(
  id: string,
  status: RecommendationStatus,
  reason: string,
): Promise<void> {
  const rec = store.get(id);
  if (!rec) return;
  if (rec.userId != null) {
    const now = Date.now();
    const outcome =
      status === "sl_hit"
        ? "loss"
        : status === "expired"
          ? "expired"
          : status === "cancelled"
            ? "cancelled"
            : status === "invalidated"
              ? "invalidated"
              : status === "tp2_hit"
                ? "win_tp2"
                : status === "tp1_hit"
                  ? "win_tp1"
                  : "pending";
    await updateTrackedRecommendation(rec.userId, rec.id, {
      status,
      outcome,
      triggeredAt: status === "triggered" ? now : undefined,
      tp1HitAt: status === "tp1_hit" ? now : undefined,
      tp2HitAt: status === "tp2_hit" ? now : undefined,
      slHitAt: status === "sl_hit" ? now : undefined,
      invalidatedAt: status === "invalidated" ? now : undefined,
      expiredAt: status === "expired" ? now : undefined,
      cancelledAt: status === "cancelled" ? now : undefined,
      lastCheckedAt: now,
      reason,
    });
  }
  await rememberActiveRecommendation({ ...rec, status });
}

export async function clearActiveRecommendation(
  sessionId: string,
  symbol?: string,
  userId?: number,
): Promise<void> {
  const rec = await getActiveRecommendation(sessionId, symbol, userId);
  if (!rec) return;
  if (rec.userId != null) await cancelTrackedRecommendation(rec.userId, rec.id);
  await rememberActiveRecommendation({ ...rec, status: "cancelled" });
}

export function isActiveRecommendationLive(
  rec: ActiveRecommendation | null | undefined,
): rec is ActiveRecommendation {
  return Boolean(rec && !isTerminal(rec.status));
}

export function recommendationDirectionAr(direction: "buy" | "sell"): string {
  return direction === "buy" ? "شراء" : "بيع";
}
