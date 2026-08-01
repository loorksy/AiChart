import { initDb, query } from "@/lib/db";
import {
  reduceProfit,
  tierPriceUsd,
  type ProfitCostRow,
  type ProfitGrantRow,
  type ProfitSubRow,
  type ProfitTopupRow,
  type ProfitUserIdentity,
} from "@/lib/billing/profitModel";

/**
 * Data layer for the platform overview (/console/platform?tab=overview).
 *
 * Every money figure comes out of @/lib/billing/profitModel, the same reducer
 * /api/admin/billing/profit uses, so the two admin screens cannot drift apart.
 *
 * Dialect rules honoured throughout (SQLite in dev, Postgres in production):
 *   - "?" placeholders only, no date/time SQL, no BOOLEAN-vs-INTEGER compare;
 *   - every SUM/COUNT wrapped in Number() — pg returns aggregates as strings;
 *   - BIGINT columns (ts, current_period_end) also arrive as strings from pg,
 *     and users.created_at is TEXT in SQLite but an ISO string in pg — hence
 *     toEpochMs() rather than trusting the driver;
 *   - day bucketing happens in JS, never in SQL.
 */

export type DashboardPeriod = 7 | 30 | 90;

export interface OverviewDelta {
  value: number;
  prev: number;
  /** null when prev === 0 — an undefined ratio is shown as «—», never ∞. */
  pct: number | null;
}

export interface OverviewKpis {
  profit_usd: OverviewDelta;
  revenue_usd: OverviewDelta;
  provider_cost_usd: OverviewDelta;
  paying_subscribers: OverviewDelta;
  gift_users: number;
  trial_users: number;
  system_cost_usd: number;
  unpriced_events: number;
}

export interface OverviewSeriesPoint {
  /** "YYYY-MM-DD" in Riyadh time. */
  day: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface OverviewLeader {
  user_id: number;
  email: string;
  tier: string | null;
  revenue_usd: number;
  provider_cost_usd: number;
  profit_usd: number;
  events: number;
}

export interface AdminOverviewUserRow {
  user_id: number;
  email: string;
  username: string | null;
  status: string;
  role: string;
  created_at_ms: number;
  tier: string | null;
  sub_status: string | null;
  period_end_ms: number | null;
  monthly_usd: number;
  topup_usd: number;
  balance_usd: number;
  events: number;
  provider_cost_usd: number;
  retail_burn_usd: number;
  last_event_ms: number | null;
  revenue_usd: number;
  profit_usd: number;
}

/** Body of GET /api/admin/overview — re-exported by the route. */
export interface AdminOverviewResponse {
  ok: true;
  days: DashboardPeriod;
  /** Epoch ms, [from, to). */
  range: { from: number; to: number };
  permissions: import("@/lib/adminRoles").AdminPermission[];
  /** null when the admin lacks profit_read — never zeros standing in for money. */
  kpis: OverviewKpis | null;
  series: OverviewSeriesPoint[];
  leaders: OverviewLeader[];
}

/** Body of GET /api/admin/overview/users — re-exported by the route. */
export interface AdminOverviewUsersResponse {
  ok: true;
  rows: AdminOverviewUserRow[];
  money_visible: boolean;
  profit_visible: boolean;
}

export interface OverviewWindow {
  days: DashboardPeriod;
  /** Current window, [from, to). */
  from: number;
  to: number;
  /** Preceding window of the same nominal length, [prevFrom, prevTo). */
  prevFrom: number;
  prevTo: number;
}

export interface OverviewData {
  range: { from: number; to: number };
  kpis: OverviewKpis;
  series: OverviewSeriesPoint[];
  leaders: OverviewLeader[];
}

const DAY_MS = 86_400_000;

/** Riyadh is UTC+3 all year — no DST, so a fixed offset is exact, not an approximation. */
export const TZ_OFFSET_MS = 3 * 3_600_000;

const LEADER_LIMIT = 8;

/**
 * Epoch ms out of whatever the driver handed back: a number (SQLite INTEGER),
 * a digit string (pg BIGINT — no int8 type parser is registered), a naive
 * "YYYY-MM-DD HH:MM:SS" UTC string (SQLite datetime('now')) or an ISO string
 * (pg TIMESTAMPTZ, stringified by normalizeRow). Unparseable input → null so
 * the caller decides what an unknown date means; it never becomes 0 by stealth.
 */
export function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (s === "") return null;
  if (/^-?\d+$/.test(s)) return Number(s);

  // SQLite's datetime('now') has no zone marker but is always UTC.
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s);
  const parsed = Date.parse(naive ? `${s.replace(" ", "T")}Z` : s);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Midnight Riyadh, as epoch ms, for the day the instant falls in. */
export function startOfRiyadhDay(ms: number): number {
  return Math.floor((ms + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

/** "YYYY-MM-DD" of the Riyadh day the instant falls in. */
export function riyadhDayKey(ms: number): string {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

export function resolvePeriod(raw: string | null | undefined): DashboardPeriod {
  const n = Number(raw);
  return n === 7 || n === 90 ? n : 30;
}

/**
 * Both windows span the same number of Riyadh day buckets. The current one ends
 * at `now`, so its last bucket is the day in progress — the chart shows that
 * partial day for what it is instead of back-dating the window to hide it.
 */
export function overviewWindow(
  days: DashboardPeriod,
  now: number = Date.now(),
): OverviewWindow {
  const from = startOfRiyadhDay(now) - (days - 1) * DAY_MS;
  return { days, from, to: now, prevFrom: from - days * DAY_MS, prevTo: from };
}

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function delta(value: number, prev: number): OverviewDelta {
  return {
    value: round2(value),
    prev: round2(prev),
    // Math.abs on the denominator so a swing out of a LOSS reads as a gain.
    pct: prev === 0 ? null : round2(((value - prev) / Math.abs(prev)) * 100),
  };
}

interface LedgerRow {
  user_id: number;
  ts: unknown;
  kind: string;
  amount_usd: number | string | null;
}

interface CostAggRow {
  user_id: number | null;
  provider_cost: number | string | null;
  retail_cost: number | string | null;
  events: number | string;
}

/** Collapse raw ledger rows falling inside [from, to) into reducer input. */
function bucketLedger(
  rows: LedgerRow[],
  from: number,
  to: number,
): { grants: ProfitGrantRow[]; topups: ProfitTopupRow[] } {
  const grants = new Map<string, ProfitGrantRow>();
  const topups = new Map<number, number>();

  for (const r of rows) {
    const ts = toEpochMs(r.ts);
    if (ts === null || ts < from || ts >= to) continue;
    if (r.kind === "topup") {
      topups.set(r.user_id, (topups.get(r.user_id) ?? 0) + Number(r.amount_usd ?? 0));
      continue;
    }
    const key = `${r.user_id}|${r.kind}`;
    const row = grants.get(key) ?? { user_id: r.user_id, kind: r.kind, months: 0 };
    row.months = Number(row.months) + 1;
    grants.set(key, row);
  }

  return {
    grants: [...grants.values()],
    topups: [...topups].map(([user_id, total]) => ({ user_id, total })),
  };
}

/** One entry per user, so the length is already the distinct-user count. */
function distinctUsersWithKind(grants: ProfitGrantRow[], kind: string): number {
  return grants.filter((g) => g.kind === kind).length;
}

export async function loadOverview(
  days: DashboardPeriod,
  now: number = Date.now(),
): Promise<OverviewData> {
  await initDb();
  const w = overviewWindow(days, now);

  const [ledger, currCosts, prevCosts, unpricedRows, seriesCostRows, subs, users] =
    await Promise.all([
      // Grants and top-ups are a handful of rows per user per month, so pulling
      // both windows raw and splitting them in JS costs nothing.
      query<LedgerRow>(
        `SELECT user_id, ts, kind, amount_usd FROM credit_ledger
         WHERE ts >= ? AND ts < ?
           AND kind IN ('monthly_grant','gift','trial_grant','topup')`,
        [w.prevFrom, w.to],
      ),
      query<CostAggRow>(
        `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
                SUM(retail_cost_usd) as retail_cost, COUNT(*) as events
         FROM usage_events WHERE ts >= ? AND ts < ? GROUP BY user_id`,
        [w.from, w.to],
      ),
      query<CostAggRow>(
        `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
                SUM(retail_cost_usd) as retail_cost, COUNT(*) as events
         FROM usage_events WHERE ts >= ? AND ts < ? GROUP BY user_id`,
        [w.prevFrom, w.prevTo],
      ),
      // Events the meter could not price: their real cost is missing from every
      // total on this screen, so the count is surfaced rather than swallowed.
      query<{ n: number | string }>(
        `SELECT COUNT(*) as n FROM usage_events
         WHERE ts >= ? AND ts < ? AND provider_cost_usd IS NULL`,
        [w.from, w.to],
      ),
      // Two columns over at most 90 days, bucketed in JS. Grouping by day in SQL
      // would mean integer-division arithmetic that reads differently under the
      // two dialects; when this table outgrows the scan the fix is a daily
      // rollup table, not a portability gamble.
      query<{ ts: unknown; provider_cost_usd: number | string | null }>(
        `SELECT ts, provider_cost_usd FROM usage_events
         WHERE ts >= ? AND ts < ? AND user_id IS NOT NULL`,
        [w.from, w.to],
      ),
      query<ProfitSubRow>("SELECT user_id, tier, status FROM subscriptions"),
      query<ProfitUserIdentity>("SELECT id, email FROM users"),
    ]);

  const curr = bucketLedger(ledger, w.from, w.to);
  const prev = bucketLedger(ledger, w.prevFrom, w.prevTo);

  const currProfit = reduceProfit({ ...curr, costs: currCosts, subs, users });
  const prevProfit = reduceProfit({ ...prev, costs: prevCosts, subs, users });

  // --- series: exactly `days` buckets, zero-seeded so gaps read as zero, not as absent
  const dayIndex = new Map<string, OverviewSeriesPoint>();
  const series: OverviewSeriesPoint[] = [];
  for (let i = 0; i < days; i++) {
    const point: OverviewSeriesPoint = {
      day: riyadhDayKey(w.from + i * DAY_MS),
      revenue: 0,
      cost: 0,
      profit: 0,
    };
    dayIndex.set(point.day, point);
    series.push(point);
  }

  const tierByUser = new Map(subs.map((s) => [s.user_id, s.tier]));
  for (const r of ledger) {
    const ts = toEpochMs(r.ts);
    if (ts === null || ts < w.from || ts >= w.to) continue;
    const point = dayIndex.get(riyadhDayKey(ts));
    if (!point) continue;
    if (r.kind === "monthly_grant") {
      point.revenue += tierPriceUsd(tierByUser.get(r.user_id));
    } else if (r.kind === "topup") {
      point.revenue += Number(r.amount_usd ?? 0);
    }
    // gift / trial_grant move credits, never money — $0 revenue by definition.
  }

  for (const r of seriesCostRows) {
    const ts = toEpochMs(r.ts);
    if (ts === null) continue;
    const point = dayIndex.get(riyadhDayKey(ts));
    if (!point) continue;
    point.cost += Number(r.provider_cost_usd ?? 0);
  }

  for (const point of series) {
    point.revenue = round2(point.revenue);
    point.cost = round2(point.cost);
    point.profit = round2(point.revenue - point.cost);
  }

  // --- leaders: top earners in the window; the client re-sorts these same rows
  // by profit ASC for the «الأكثر خسارة» view.
  const leaders: OverviewLeader[] = currProfit.perUser
    .filter((r) => r.revenue_usd > 0 || r.provider_cost_usd > 0 || r.events > 0)
    .sort((a, b) => b.revenue_usd - a.revenue_usd || a.profit_usd - b.profit_usd)
    .slice(0, LEADER_LIMIT)
    .map((r) => ({
      user_id: r.user_id,
      email: r.email,
      tier: r.tier,
      revenue_usd: round2(r.revenue_usd),
      provider_cost_usd: round2(r.provider_cost_usd),
      profit_usd: round2(r.profit_usd),
      events: r.events,
    }));

  const payingNow = distinctUsersWithKind(curr.grants, "monthly_grant");
  const payingPrev = distinctUsersWithKind(prev.grants, "monthly_grant");

  return {
    range: { from: w.from, to: w.to },
    kpis: {
      profit_usd: delta(currProfit.totals.profit_usd, prevProfit.totals.profit_usd),
      revenue_usd: delta(currProfit.totals.revenue_usd, prevProfit.totals.revenue_usd),
      provider_cost_usd: delta(
        currProfit.totals.provider_cost_usd,
        prevProfit.totals.provider_cost_usd,
      ),
      paying_subscribers: delta(payingNow, payingPrev),
      gift_users: distinctUsersWithKind(curr.grants, "gift"),
      trial_users: distinctUsersWithKind(curr.grants, "trial_grant"),
      // Kept out of provider_cost_usd on purpose: that KPI is the sum of the
      // per-user costs, exactly as /api/admin/billing/profit reports it.
      system_cost_usd: round2(currProfit.systemCostUsd),
      unpriced_events: Number(unpricedRows[0]?.n ?? 0),
    },
    series,
    leaders,
  };
}

interface UserIdentityRow {
  id: number;
  email: string;
  username: string | null;
  status: string;
  role: string;
  created_at: unknown;
}

interface SubscriptionRow {
  user_id: number;
  tier: string;
  status: string;
  current_period_end: unknown;
}

interface BalanceRow {
  user_id: number;
  monthly_usd: number | string | null;
  topup_usd: number | string | null;
}

interface UserUsageRow extends CostAggRow {
  last_ts: unknown;
}

/**
 * One row per user, all-time. Revenue and profit are the same figures the
 * profit screen shows for that user — same reducer, same unwindowed rows.
 */
export async function loadOverviewUsers(): Promise<AdminOverviewUserRow[]> {
  await initDb();

  const [users, subs, balances, usage, grants, topups] = await Promise.all([
    query<UserIdentityRow>(
      "SELECT id, email, username, status, role, created_at FROM users",
    ),
    query<SubscriptionRow>(
      "SELECT user_id, tier, status, current_period_end FROM subscriptions",
    ),
    query<BalanceRow>("SELECT user_id, monthly_usd, topup_usd FROM credit_balances"),
    query<UserUsageRow>(
      `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
              SUM(retail_cost_usd) as retail_cost, COUNT(*) as events,
              MAX(ts) as last_ts
       FROM usage_events GROUP BY user_id`,
    ),
    query<ProfitGrantRow>(
      `SELECT user_id, kind, COUNT(*) as months FROM credit_ledger
       WHERE kind IN ('monthly_grant','gift','trial_grant') GROUP BY user_id, kind`,
    ),
    query<ProfitTopupRow>(
      `SELECT user_id, SUM(amount_usd) as total FROM credit_ledger
       WHERE kind = 'topup' GROUP BY user_id`,
    ),
  ]);

  const identities: ProfitUserIdentity[] = users.map((u) => ({
    id: u.id,
    email: u.email,
  }));
  const costs: ProfitCostRow[] = usage.map((u) => ({
    user_id: u.user_id,
    provider_cost: u.provider_cost,
    retail_cost: u.retail_cost,
    events: u.events,
  }));
  const subRows: ProfitSubRow[] = subs.map((s) => ({
    user_id: s.user_id,
    tier: s.tier,
    status: s.status,
  }));

  const { perUser } = reduceProfit({
    grants,
    topups,
    costs,
    subs: subRows,
    users: identities,
  });

  const profitByUser = new Map(perUser.map((r) => [r.user_id, r]));
  const subByUser = new Map(subs.map((s) => [s.user_id, s]));
  const balanceByUser = new Map(balances.map((b) => [b.user_id, b]));
  const usageByUser = new Map<number, UserUsageRow>();
  for (const u of usage) {
    if (u.user_id != null) usageByUser.set(u.user_id, u);
  }

  const rows: AdminOverviewUserRow[] = users.map((u) => {
    const sub = subByUser.get(u.id);
    const balance = balanceByUser.get(u.id);
    const events = usageByUser.get(u.id);
    const money = profitByUser.get(u.id);

    const monthly = round2(Number(balance?.monthly_usd ?? 0));
    const topup = round2(Number(balance?.topup_usd ?? 0));

    return {
      user_id: u.id,
      email: u.email,
      username: u.username ?? null,
      status: u.status,
      role: u.role,
      // A user always has a created_at; 0 only if the column is corrupt, and 0
      // sorts last rather than pretending the account is new.
      created_at_ms: toEpochMs(u.created_at) ?? 0,
      tier: sub?.tier ?? null,
      sub_status: sub?.status ?? null,
      period_end_ms: toEpochMs(sub?.current_period_end),
      monthly_usd: monthly,
      topup_usd: topup,
      balance_usd: round2(monthly + topup),
      events: Number(events?.events ?? 0),
      provider_cost_usd: round2(Number(events?.provider_cost ?? 0)),
      retail_burn_usd: round2(Number(events?.retail_cost ?? 0)),
      last_event_ms: toEpochMs(events?.last_ts),
      revenue_usd: round2(money?.revenue_usd ?? 0),
      profit_usd: round2(money?.profit_usd ?? 0),
    };
  });

  // Newest first. Sorting on normalised ms rather than in SQL keeps the order
  // identical across the TEXT (SQLite) / TIMESTAMPTZ (pg) split.
  rows.sort((a, b) => b.created_at_ms - a.created_at_ms || b.user_id - a.user_id);
  return rows;
}

/**
 * Zero the columns an admin is not cleared to see. The row shape stays stable
 * for the table, and the route ships money_visible / profit_visible alongside
 * so the UI drops those columns entirely rather than rendering a wall of $0
 * that an operator could mistake for a real reading.
 */
export function redactUserRows(
  rows: AdminOverviewUserRow[],
  visibility: { money: boolean; profit: boolean },
): AdminOverviewUserRow[] {
  if (visibility.money && visibility.profit) return rows;
  return rows.map((r) => ({
    ...r,
    monthly_usd: visibility.money ? r.monthly_usd : 0,
    topup_usd: visibility.money ? r.topup_usd : 0,
    balance_usd: visibility.money ? r.balance_usd : 0,
    provider_cost_usd: visibility.money ? r.provider_cost_usd : 0,
    retail_burn_usd: visibility.money ? r.retail_burn_usd : 0,
    revenue_usd: visibility.profit ? r.revenue_usd : 0,
    profit_usd: visibility.profit ? r.profit_usd : 0,
  }));
}
