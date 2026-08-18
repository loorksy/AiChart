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
    `SELECT r.id AS recommendation_id, r.symbol, r.timeframe,
            'direct_analysis' AS strategy_id,
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
