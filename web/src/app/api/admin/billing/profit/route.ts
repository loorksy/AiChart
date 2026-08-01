import { NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { initDb, query } from "@/lib/db";
import { requireAdminWith } from "@/lib/adminRoles";
import {
  reduceProfit,
  type ProfitCostRow,
  type ProfitGrantRow,
  type ProfitSubRow,
  type ProfitTopupRow,
  type ProfitUserIdentity,
} from "@/lib/billing/profitModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2-A6 (#95, بند 12): per-user profitability, auditable to the event level.
 *
 * The arithmetic now lives in @/lib/billing/profitModel so the platform
 * overview reduces the identical rows the identical way. The rows selected
 * here, the response shape and the note below are unchanged.
 */
export async function GET() {
  try {
    await requireAdminWith("profit_read");
    await initDb();

    const [grants, topups, costs, subs, users] = await Promise.all([
      query<ProfitGrantRow>(
        `SELECT user_id, kind, COUNT(*) as months FROM credit_ledger
         WHERE kind IN ('monthly_grant','gift','trial_grant') GROUP BY user_id, kind`,
      ),
      query<ProfitTopupRow>(
        `SELECT user_id, SUM(amount_usd) as total FROM credit_ledger
         WHERE kind = 'topup' GROUP BY user_id`,
      ),
      query<ProfitCostRow>(
        `SELECT user_id, SUM(provider_cost_usd) as provider_cost,
                SUM(retail_cost_usd) as retail_cost, COUNT(*) as events
         FROM usage_events GROUP BY user_id`,
      ),
      query<ProfitSubRow>("SELECT user_id, tier, status FROM subscriptions"),
      query<ProfitUserIdentity>("SELECT id, email FROM users"),
    ]);

    const { perUser, systemCostUsd, totals } = reduceProfit({
      grants,
      topups,
      costs,
      subs,
      users,
    });

    return NextResponse.json({
      ok: true,
      per_user: perUser,
      totals: { ...totals, system_cost_usd: systemCostUsd },
      note:
        "revenue = paid monthly grants at tier list price + top-ups; gifts/trials are $0 revenue. cost = provider cost of metered usage.",
    });
  } catch (err) {
    return handleError(err);
  }
}
