import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { initDb, query } from "@/lib/db";
import { requireAdminWith } from "@/lib/adminRoles";
import { TIERS, type TierId } from "@/lib/billing/tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-A6 (#95, بند 12): per-user profitability, auditable to the event level.
 *
 * revenue  = paid monthly grants × the tier's list price + top-up amounts
 *            (gift months and trial credits count as $0 revenue — honest);
 * cost     = Σ usage_events.provider_cost_usd (LLM today; MetaApi deploy
 *            hours will land in the same table family in Phase B);
 * profit   = revenue − cost. Users with cost but no revenue DO appear —
 *            those are the accounts losing money.
 */
export async function GET() {
  try {
    await requireAdminWith("profit_read");
    await initDb();

    const [grants, topups, costs, subs, users] = await Promise.all([
      query<{ user_id: number; months: number; kind: string }>(
        `SELECT user_id, kind, COUNT(*) as months FROM credit_ledger
         WHERE kind IN ('monthly_grant','gift','trial_grant') GROUP BY user_id, kind`,
      ),
      query<{ user_id: number; total: number }>(
        `SELECT user_id, SUM(amount_usd) as total FROM credit_ledger
         WHERE kind = 'topup' GROUP BY user_id`,
      ),
      query<{ user_id: number | null; provider_cost: number; retail_cost: number; events: number }>(
        `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
                SUM(retail_cost_usd) as retail_cost, COUNT(*) as events
         FROM usage_events GROUP BY user_id`,
      ),
      query<{ user_id: number; tier: string; status: string }>(
        "SELECT user_id, tier, status FROM subscriptions",
      ),
      query<{ id: number; email: string }>("SELECT id, email FROM users"),
    ]);

    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const tierById = new Map(subs.map((s) => [s.user_id, s]));
    const rows = new Map<
      number,
      {
        user_id: number;
        email: string;
        tier: string | null;
        status: string | null;
        revenue_usd: number;
        provider_cost_usd: number;
        retail_burn_usd: number;
        events: number;
        gift_months: number;
      }
    >();
    const ensure = (userId: number) => {
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
        };
        rows.set(userId, row);
      }
      return row;
    };

    for (const g of grants) {
      const row = ensure(g.user_id);
      if (g.kind === "monthly_grant") {
        const tier = TIERS[(row.tier ?? "") as TierId];
        row.revenue_usd += (tier?.priceUsd ?? 0) * Number(g.months);
      } else {
        row.gift_months += Number(g.months);
      }
    }
    for (const t of topups) ensure(t.user_id).revenue_usd += Number(t.total ?? 0);
    let systemCost = 0;
    for (const c of costs) {
      if (c.user_id == null) {
        systemCost += Number(c.provider_cost ?? 0);
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

    const totals = perUser.reduce(
      (acc, r) => ({
        revenue_usd: acc.revenue_usd + r.revenue_usd,
        provider_cost_usd: acc.provider_cost_usd + r.provider_cost_usd,
        profit_usd: acc.profit_usd + r.profit_usd,
      }),
      { revenue_usd: 0, provider_cost_usd: 0, profit_usd: 0 },
    );

    return NextResponse.json({
      ok: true,
      per_user: perUser,
      totals: { ...totals, system_cost_usd: systemCost },
      note:
        "revenue = paid monthly grants at tier list price + top-ups; gifts/trials are $0 revenue. cost = provider cost of metered usage.",
    });
  } catch (err) {
    return handleError(err);
  }
}
