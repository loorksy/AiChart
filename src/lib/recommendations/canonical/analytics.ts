import { query } from "@/lib/db";

export interface AnalyticsGroup {
  key: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  averageR: number;
}

export interface CanonicalRecommendationAnalytics {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  averageR: number;
  profitFactor: number | null;
  expectancy: number;
  averageHoldingMs: number;
  averageMae: number;
  averageMfe: number;
  bySymbol: AnalyticsGroup[];
  byTimeframe: AnalyticsGroup[];
  byStrategy: AnalyticsGroup[];
  byConfidence: AnalyticsGroup[];
  bySession: AnalyticsGroup[];
  byExitReason: AnalyticsGroup[];
  byEntryType: AnalyticsGroup[];
  byMonth: AnalyticsGroup[];
  byDay: AnalyticsGroup[];
}

interface AnalyticsRow {
  recommendation_id: number;
  symbol: string;
  timeframe: string | null;
  strategy_id: string | null;
  confidence: number;
  session_id: string | null;
  entry_type: string | null;
  status: string;
  created_at: string | number;
  r_multiple: number | null;
  holding_ms: number | null;
  mae: number | null;
  mfe: number | null;
  outcome_type: string | null;
}

interface Summary {
  row: AnalyticsRow;
  win: boolean;
  loss: boolean;
  r: number;
  holdingMs: number;
  mae: number;
  mfe: number;
}

function createdDate(value: string | number): Date {
  return new Date(typeof value === "number" ? value : value);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarize(rows: AnalyticsRow[]): Summary[] {
  const byId = new Map<number, AnalyticsRow[]>();
  for (const row of rows) byId.set(row.recommendation_id, [...(byId.get(row.recommendation_id) ?? []), row]);
  return [...byId.values()].map((items) => {
    const row = items[0]!;
    const rs = items.map((item) => item.r_multiple).filter((v): v is number => v != null);
    const outcomeTypes = new Set(items.map((item) => item.outcome_type));
    const win = row.status === "tp_hit" || outcomeTypes.has("TP3");
    const loss = row.status === "sl_hit" || outcomeTypes.has("SL");
    return {
      row,
      win,
      loss,
      r: rs.length ? rs.reduce((sum, value) => sum + Number(value), 0) : win ? 1 : loss ? -1 : 0,
      holdingMs: Math.max(0, ...items.map((item) => Number(item.holding_ms ?? 0))),
      mae: Math.max(0, ...items.map((item) => Number(item.mae ?? 0))),
      mfe: Math.max(0, ...items.map((item) => Number(item.mfe ?? 0))),
    };
  });
}

function group(items: Summary[], key: (item: Summary) => string): AnalyticsGroup[] {
  const groups = new Map<string, Summary[]>();
  for (const item of items) groups.set(key(item) || "unknown", [...(groups.get(key(item) || "unknown") ?? []), item]);
  return [...groups.entries()]
    .map(([groupKey, values]) => {
      const wins = values.filter((value) => value.win).length;
      const losses = values.filter((value) => value.loss).length;
      const completed = wins + losses;
      return {
        key: groupKey,
        total: values.length,
        wins,
        losses,
        winRate: completed ? (wins / completed) * 100 : 0,
        averageR: mean(values.map((value) => value.r)),
      };
    })
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export async function computeCanonicalRecommendationAnalytics(
  userId: number,
): Promise<CanonicalRecommendationAnalytics> {
  const rows = await query<AnalyticsRow>(
    `SELECT r.id AS recommendation_id, r.symbol, r.timeframe, r.strategy_id,
            r.confidence, r.session_id, r.entry_type, r.status, r.created_at,
            o.r_multiple, o.holding_ms, o.mae, o.mfe, o.outcome_type
       FROM recommendations r
       LEFT JOIN recommendation_outcomes o
         ON o.recommendation_id = r.id AND o.user_id = r.user_id
      WHERE r.user_id = ? ORDER BY r.id ASC, o.id ASC`,
    [userId],
  );
  const items = summarize(rows);
  const wins = items.filter((item) => item.win).length;
  const losses = items.filter((item) => item.loss).length;
  const completed = wins + losses;
  const positive = items.filter((item) => item.r > 0).reduce((sum, item) => sum + item.r, 0);
  const negative = Math.abs(items.filter((item) => item.r < 0).reduce((sum, item) => sum + item.r, 0));
  return {
    total: items.length,
    wins,
    losses,
    winRate: completed ? (wins / completed) * 100 : 0,
    lossRate: completed ? (losses / completed) * 100 : 0,
    averageR: mean(items.map((item) => item.r)),
    profitFactor: negative > 0 ? positive / negative : positive > 0 ? null : 0,
    expectancy: mean(items.map((item) => item.r)),
    averageHoldingMs: mean(items.map((item) => item.holdingMs)),
    averageMae: mean(items.map((item) => item.mae)),
    averageMfe: mean(items.map((item) => item.mfe)),
    bySymbol: group(items, (item) => item.row.symbol),
    byTimeframe: group(items, (item) => item.row.timeframe ?? "unknown"),
    byStrategy: group(items, (item) => item.row.strategy_id ?? "unspecified"),
    byConfidence: group(items, (item) => `${Math.floor(Number(item.row.confidence) / 10) * 10}-${Math.min(100, Math.floor(Number(item.row.confidence) / 10) * 10 + 9)}`),
    bySession: group(items, (item) => item.row.session_id ?? "unknown"),
    byExitReason: group(items, (item) => item.row.status),
    byEntryType: group(items, (item) => item.row.entry_type ?? "unknown"),
    byMonth: group(items, (item) => createdDate(item.row.created_at).toISOString().slice(0, 7)),
    byDay: group(items, (item) => createdDate(item.row.created_at).toISOString().slice(0, 10)),
  };
}

// ─── Adherence metrics (plan §15 J) ─────────────────────────────────────────
//
// How closely the executed trades matched the plans. These lived half in the
// performance journal (entry/stop adherence) and half re-derived ad hoc in the
// journal API route (early exit, entry delay); this module is now the canonical
// home for both halves. Descriptive only — nothing here gates a recommendation.

/**
 * Relative tolerance for "entered where the plan said" / "kept the plan's stop".
 * A FRACTION of the plan price, so one threshold means the same thing on
 * EURUSD and on XAUUSD.
 */
export const ADHERENCE_PRICE_TOLERANCE = 0.0005;

/**
 * An order raised this long after the plan first became enterable counts as a
 * delayed (time) entry. Owned here so the journal API and UI cannot drift.
 */
export const DELAYED_ENTRY_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Adverse fill beyond this many ATRs past preferred entry is a price late entry.
 * Absolute pip thresholds are forbidden — they lie across EURUSD vs XAUUSD.
 */
export const LATE_ENTRY_ATR_MULTIPLE = 0.25;

export interface AdherenceEntry {
  /** Fill price minus plan price, as a fraction of the plan price. */
  entryDeviation: number | null;
  /** True when the executed stop matched the plan's. */
  stopMatchedPlan: boolean | null;
}

/** How the fill sat relative to the effective revision's entry geometry. */
export type LateEntryVerdict =
  | "on_plan"
  | "better"
  | "late"
  | "outside_zone"
  | "unknown";

/**
 * Price late-entry from the revision that was effective at execution — not the
 * latest revision after later trade-management changes.
 *
 * BUY: fill above preferred (worse) is late; below preferred is better.
 * SELL: fill below preferred is late; above preferred is better.
 * Zone membership and ATR distance refine the label without absolute pip cuts.
 */
export function classifyLateEntry(input: {
  direction: "buy" | "sell";
  preferredEntry: number | null;
  entryZone: { low: number; high: number } | null;
  fillPrice: number | null;
  atr: number | null;
}): {
  verdict: LateEntryVerdict;
  /** Signed fraction of preferred: +adverse for the direction, −better. */
  adverseFraction: number | null;
  lateByAtr: number | null;
} {
  const { direction, preferredEntry, entryZone, fillPrice, atr } = input;
  if (fillPrice == null || !Number.isFinite(fillPrice)) {
    return { verdict: "unknown", adverseFraction: null, lateByAtr: null };
  }
  if (preferredEntry == null || !Number.isFinite(preferredEntry) || preferredEntry === 0) {
    if (
      entryZone &&
      Number.isFinite(entryZone.low) &&
      Number.isFinite(entryZone.high) &&
      fillPrice >= Math.min(entryZone.low, entryZone.high) &&
      fillPrice <= Math.max(entryZone.low, entryZone.high)
    ) {
      return { verdict: "on_plan", adverseFraction: null, lateByAtr: null };
    }
    return {
      verdict: entryZone ? "outside_zone" : "unknown",
      adverseFraction: null,
      lateByAtr: null,
    };
  }

  const signed =
    direction === "buy"
      ? (fillPrice - preferredEntry) / preferredEntry
      : (preferredEntry - fillPrice) / preferredEntry;
  const lateByAtr =
    atr != null && Number.isFinite(atr) && atr > 0
      ? (direction === "buy" ? fillPrice - preferredEntry : preferredEntry - fillPrice) / atr
      : null;

  const inZone =
    entryZone &&
    Number.isFinite(entryZone.low) &&
    Number.isFinite(entryZone.high) &&
    fillPrice >= Math.min(entryZone.low, entryZone.high) &&
    fillPrice <= Math.max(entryZone.low, entryZone.high);

  if (signed <= ADHERENCE_PRICE_TOLERANCE && signed >= -ADHERENCE_PRICE_TOLERANCE) {
    return { verdict: "on_plan", adverseFraction: signed, lateByAtr };
  }
  if (signed < 0) {
    return { verdict: "better", adverseFraction: signed, lateByAtr };
  }
  const atrLate =
    lateByAtr != null && lateByAtr > LATE_ENTRY_ATR_MULTIPLE;
  const fractionLate = signed > ADHERENCE_PRICE_TOLERANCE;
  if (atrLate || fractionLate) {
    if (inZone === false) {
      return { verdict: "outside_zone", adverseFraction: signed, lateByAtr };
    }
    return { verdict: "late", adverseFraction: signed, lateByAtr };
  }
  return { verdict: "on_plan", adverseFraction: signed, lateByAtr };
}

/**
 * Why the trade left the market — distinct from "early exit" which is only the
 * user-abandonment case (manual close before any target paid).
 */
export type ExitKind =
  | "user_early_exit"
  | "stop_loss"
  | "trailing_or_management"
  | "broker_close"
  | "partial_close"
  | "take_profit"
  | "unknown";

export function classifyExit(input: {
  outcomeType: string | null;
  /** Explicit close reason when the broker recorded one. */
  closeReason?: string | null;
  manualCloseAt: number | null;
  firstTakeProfitAt: number | null;
  stopHitAt?: number | null;
}): ExitKind {
  const reason = (input.closeReason ?? "").toLowerCase();
  if (reason.includes("partial")) return "partial_close";
  if (reason.includes("trail") || reason.includes("manage")) {
    return "trailing_or_management";
  }
  if (reason.includes("broker") || reason.includes("margin") || reason.includes("stop_out")) {
    return "broker_close";
  }

  const outcome = input.outcomeType ?? "";
  if (outcome === "TP1" || outcome === "TP2" || outcome === "TP3") {
    return "take_profit";
  }
  if (outcome === "SL" || input.stopHitAt != null) return "stop_loss";
  if (
    isEarlyExit({
      manualCloseAt: input.manualCloseAt,
      firstTakeProfitAt: input.firstTakeProfitAt,
    })
  ) {
    return "user_early_exit";
  }
  if (outcome === "ManualClose" && input.firstTakeProfitAt != null) {
    return "trailing_or_management";
  }
  return "unknown";
}

export function isDelayedEntry(entryDelayMs: number | null): boolean {
  return entryDelayMs != null && entryDelayMs >= DELAYED_ENTRY_THRESHOLD_MS;
}

/** Aggregate adherence counts the journal UI used to recompute locally. */
export function summarizeAdherence(input: {
  entries: readonly AdherenceEntry[];
  entryDelayMsList: readonly (number | null)[];
  earlyExitFlags: readonly boolean[];
}): {
  entryAdherence: number | null;
  stopAdherence: number | null;
  delayedEntryCount: number;
  earlyExitCount: number;
} {
  return {
    entryAdherence: computeEntryAdherence(input.entries),
    stopAdherence: computeStopAdherence(input.entries),
    delayedEntryCount: input.entryDelayMsList.filter(isDelayedEntry).length,
    earlyExitCount: input.earlyExitFlags.filter(Boolean).length,
  };
}

/** Share of entries filled within tolerance of the plan price; null without data. */
export function computeEntryAdherence(entries: readonly AdherenceEntry[]): number | null {
  const withDeviation = entries.filter((entry) => entry.entryDeviation != null);
  if (!withDeviation.length) return null;
  const closeEnough = withDeviation.filter(
    (entry) => Math.abs(entry.entryDeviation!) <= ADHERENCE_PRICE_TOLERANCE,
  );
  return closeEnough.length / withDeviation.length;
}

/** Share of executed stops that matched the plan's stop; null without data. */
export function computeStopAdherence(entries: readonly AdherenceEntry[]): number | null {
  const withStop = entries.filter((entry) => entry.stopMatchedPlan != null);
  if (!withStop.length) return null;
  return withStop.filter((entry) => entry.stopMatchedPlan).length / withStop.length;
}

/**
 * Late entry: how long after the plan FIRST became enterable (its first
 * transition to `triggered`) the order was actually raised (the first linked
 * trade's creation). Null when either side never happened.
 */
export function computeEntryDelayMs(input: {
  firstTriggeredAt: number | null;
  firstTradeAt: number | null;
}): number | null {
  if (input.firstTriggeredAt == null || input.firstTradeAt == null) return null;
  return Math.max(0, input.firstTradeAt - input.firstTriggeredAt);
}

/**
 * Early exit: the trade was closed manually BEFORE the plan paid any target.
 * A manual close after TP1 is management, not abandonment, and does not count.
 */
export function isEarlyExit(input: {
  manualCloseAt: number | null;
  firstTakeProfitAt: number | null;
}): boolean {
  if (input.manualCloseAt == null) return false;
  return input.firstTakeProfitAt == null || input.manualCloseAt < input.firstTakeProfitAt;
}

export interface RecommendationAdherenceFacts {
  /** Latest realised R multiple per recommendation id. */
  rMultipleById: Map<string, number>;
  /** Recommendations whose trade was closed manually before any TP outcome. */
  earlyExitIds: Set<string>;
  /** First activation → first linked trade creation, per recommendation id. */
  entryDelayMsById: Map<string, number>;
}

interface OutcomeFactRow {
  recommendation_id: number | string;
  outcome_type: string;
  r_multiple: number | string | null;
  occurred_at: number | string;
}

interface TransitionFactRow {
  recommendation_id: number | string;
  occurred_at: number | string;
}

interface IntentFactRow {
  recommendation_id: number | string;
  created_at: number | string | null;
}

/** Timestamps are epoch-ish on sqlite and timestamp strings on pg. */
function toMs(value: number | string | null): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the adherence facts for one operator: realised R, early exits, and entry
 * delays, keyed by canonical recommendation id (as a string, matching the
 * journal's entry ids). Read-only joins over existing tables.
 */
export async function collectAdherenceFacts(
  userId: number,
): Promise<RecommendationAdherenceFacts> {
  const [outcomeRows, triggeredRows, intentRows] = await Promise.all([
    query<OutcomeFactRow>(
      `SELECT recommendation_id, outcome_type, r_multiple, occurred_at
         FROM recommendation_outcomes WHERE user_id = ?
        ORDER BY occurred_at DESC`,
      [userId],
    ).catch(() => [] as OutcomeFactRow[]),
    query<TransitionFactRow>(
      `SELECT recommendation_id, occurred_at FROM recommendation_transitions
        WHERE user_id = ? AND to_status = 'triggered'`,
      [userId],
    ).catch(() => [] as TransitionFactRow[]),
    query<IntentFactRow>(
      `SELECT i.recommendation_id, t.created_at
         FROM trade_intents i JOIN trades t ON t.intent_id = i.id
        WHERE i.user_id = ? AND i.recommendation_id IS NOT NULL`,
      [userId],
    ).catch(() => [] as IntentFactRow[]),
  ]);

  // Newest-first, so the first r_multiple seen per plan is the latest.
  const rMultipleById = new Map<string, number>();
  const manualCloseAtById = new Map<string, number>();
  const firstTakeProfitAtById = new Map<string, number>();
  for (const row of outcomeRows) {
    const id = String(row.recommendation_id);
    const r = Number(row.r_multiple);
    if (!rMultipleById.has(id) && row.r_multiple != null && Number.isFinite(r)) {
      rMultipleById.set(id, r);
    }
    const at = toMs(row.occurred_at);
    if (at == null) continue;
    if (row.outcome_type === "ManualClose") {
      const known = manualCloseAtById.get(id);
      if (known == null || at < known) manualCloseAtById.set(id, at);
    }
    if (row.outcome_type === "TP1" || row.outcome_type === "TP2" || row.outcome_type === "TP3") {
      const known = firstTakeProfitAtById.get(id);
      if (known == null || at < known) firstTakeProfitAtById.set(id, at);
    }
  }

  const earlyExitIds = new Set<string>();
  for (const [id, manualCloseAt] of manualCloseAtById) {
    if (isEarlyExit({ manualCloseAt, firstTakeProfitAt: firstTakeProfitAtById.get(id) ?? null })) {
      earlyExitIds.add(id);
    }
  }

  // Keep the FIRST activation: a delayed entry is measured from the moment the
  // plan first became enterable.
  const triggeredAtById = new Map<string, number>();
  for (const row of triggeredRows) {
    const at = toMs(row.occurred_at);
    const id = String(row.recommendation_id);
    if (at != null && (!triggeredAtById.has(id) || at < triggeredAtById.get(id)!)) {
      triggeredAtById.set(id, at);
    }
  }

  const tradeAtById = new Map<string, number>();
  for (const row of intentRows) {
    const at = toMs(row.created_at);
    const id = String(row.recommendation_id);
    if (at != null && (!tradeAtById.has(id) || at < tradeAtById.get(id)!)) {
      tradeAtById.set(id, at);
    }
  }

  const entryDelayMsById = new Map<string, number>();
  for (const [id, firstTriggeredAt] of triggeredAtById) {
    const delay = computeEntryDelayMs({
      firstTriggeredAt,
      firstTradeAt: tradeAtById.get(id) ?? null,
    });
    if (delay != null) entryDelayMsById.set(id, delay);
  }

  return { rMultipleById, earlyExitIds, entryDelayMsById };
}
