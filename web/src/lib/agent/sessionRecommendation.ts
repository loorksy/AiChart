import type { ChartDrawing } from "@/lib/chartDrawings";

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
  entry: number;
  entryType?: "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";
  stopLoss: number;
  targets: number[];
  takeProfit?: number;
  rr?: number;
  status: RecommendationStatus;
  triggerCondition: string;
  invalidationLevel: number;
  invalidationRule: string;
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
): Promise<ActiveRecommendation | null> {
  const rec =
    store.get(key(sessionId, symbol)) ??
    store.get(key(sessionId)) ??
    null;
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
  _reason: string,
): Promise<void> {
  const rec = store.get(id);
  if (!rec) return;
  await rememberActiveRecommendation({ ...rec, status });
}

export async function clearActiveRecommendation(
  sessionId: string,
  symbol?: string,
): Promise<void> {
  const rec = await getActiveRecommendation(sessionId, symbol);
  if (!rec) return;
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
