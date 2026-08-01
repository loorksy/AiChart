import { TIERS, type TierId } from "./tiers";

/**
 * V2-A6 (#95): the ONE revenue/cost/profit reducer for every admin money screen.
 *
 * Lifted verbatim out of /api/admin/billing/profit so the profit table and the
 * platform overview can never disagree — same rows in, same numbers out. This
 * module is a pure reducer: SELECTing the rows (and windowing them by ts) is
 * the caller's job.
 *
 *   revenue = paid monthly grants × the tier's list price + top-up amounts
 *             (gift months and trial credits count as $0 revenue — honest);
 *   cost    = Σ usage_events.provider_cost_usd;
 *   profit  = revenue − cost.
 *
 * CAVEAT worth knowing before anyone "improves" it: a monthly_grant is priced at
 * the user's CURRENT subscription tier, because the ledger never recorded the
 * tier in force at grant time. A user who upgraded mid-history has their older
 * months repriced at the new tier. This is the shipped definition; changing it
 * here would silently move the numbers on a screen the operator already trusts.
 */

/** One `credit_ledger` grant kind, already collapsed to a per-user count. */
export interface ProfitGrantRow {
  user_id: number;
  kind: string;
  /** COUNT(*) — pg hands aggregates back as strings, so it may arrive as text. */
  months: number | string;
}

export interface ProfitTopupRow {
  user_id: number;
  total: number | string | null;
}

/** `usage_events` aggregate. `user_id === null` is platform/system spend. */
export interface ProfitCostRow {
  user_id: number | null;
  provider_cost: number | string | null;
  retail_cost: number | string | null;
  events: number | string;
}

export interface ProfitSubRow {
  user_id: number;
  tier: string;
  status: string;
}

export interface ProfitUserIdentity {
  id: number;
  email: string;
}

/** Key order matters: it is the JSON shape /api/admin/billing/profit ships. */
export interface ProfitUserRow {
  user_id: number;
  email: string;
  tier: string | null;
  status: string | null;
  revenue_usd: number;
  provider_cost_usd: number;
  retail_burn_usd: number;
  events: number;
  gift_months: number;
  profit_usd: number;
}

export interface ProfitTotals {
  revenue_usd: number;
  provider_cost_usd: number;
  profit_usd: number;
}

export interface ProfitModelResult {
  /** Sorted by profit ASC — the accounts losing money come first. */
  perUser: ProfitUserRow[];
  systemCostUsd: number;
  totals: ProfitTotals;
}

export interface ProfitModelInput {
  grants: ProfitGrantRow[];
  topups: ProfitTopupRow[];
  costs: ProfitCostRow[];
  subs: ProfitSubRow[];
  users: ProfitUserIdentity[];
}

/** List price of a tier id; unknown / missing subscription = $0, never a guess. */
export function tierPriceUsd(tier: string | null | undefined): number {
  return TIERS[(tier ?? "") as TierId]?.priceUsd ?? 0;
}

export function reduceProfit(input: ProfitModelInput): ProfitModelResult {
  const { grants, topups, costs, subs, users } = input;

  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const tierById = new Map(subs.map((s) => [s.user_id, s]));
  const rows = new Map<number, ProfitUserRow>();

  const ensure = (userId: number): ProfitUserRow => {
    let row = rows.get(userId);
    if (!row) {
      const sub = tierById.get(userId);
      row = {
        user_id: userId,
        email: emailById.get(userId) ?? `#${userId}`,
        tier: sub?.tier ?? null,
        status: sub?.status ?? null,
        revenue_usd: 0,
        provider_cost_usd: 0,
        retail_burn_usd: 0,
        events: 0,
        gift_months: 0,
        profit_usd: 0,
      };
      rows.set(userId, row);
    }
    return row;
  };

  for (const g of grants) {
    const row = ensure(g.user_id);
    if (g.kind === "monthly_grant") {
      row.revenue_usd += tierPriceUsd(row.tier) * Number(g.months);
    } else {
      row.gift_months += Number(g.months);
    }
  }
  for (const t of topups) ensure(t.user_id).revenue_usd += Number(t.total ?? 0);

  let systemCostUsd = 0;
  for (const c of costs) {
    if (c.user_id == null) {
      systemCostUsd += Number(c.provider_cost ?? 0);
      continue;
    }
    const row = ensure(c.user_id);
    row.provider_cost_usd = Number(c.provider_cost ?? 0);
    row.retail_burn_usd = Number(c.retail_cost ?? 0);
    row.events = Number(c.events ?? 0);
  }

  const perUser = [...rows.values()]
    .map((r) => ({ ...r, profit_usd: r.revenue_usd - r.provider_cost_usd }))
    .sort((a, b) => a.profit_usd - b.profit_usd);

  const totals = perUser.reduce<ProfitTotals>(
    (acc, r) => ({
      revenue_usd: acc.revenue_usd + r.revenue_usd,
      provider_cost_usd: acc.provider_cost_usd + r.provider_cost_usd,
      profit_usd: acc.profit_usd + r.profit_usd,
    }),
    { revenue_usd: 0, provider_cost_usd: 0, profit_usd: 0 },
  );

  return { perUser, systemCostUsd, totals };
}
